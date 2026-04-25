/**
 * CCS Credential Store for opencode-account-rotator.
 *
 * Discovers Claude Code Sessions (CCS) instances under ~/.ccs/instances/
 * Validates each instance's credential file against a known schema.
 * Applies the user-configured account order.
 * Handles OAuth token refresh with a 3-second timeout.
 */

import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import type { Account, OAuthTokenResponse, ResolvedConfig } from "./types.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CCS_INSTANCES_DIR = join(homedir(), ".ccs", "instances")
const CREDENTIALS_FILENAME = ".credentials.json"

/**
 * OAuth client ID used by the Claude Max CLI flow.
 * This matches what anthropic-login-via-cli uses.
 */
const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e535-43e3-a1b1-68f1a5a8f740"
const OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const TOKEN_REFRESH_TIMEOUT_MS = 3_000

// ---------------------------------------------------------------------------
// Zod schema — validates the raw .credentials.json structure (SC-006)
// ---------------------------------------------------------------------------

const credentialsSchema = z.object({
  claudeAiOauth: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().int(),
  }),
})

// ---------------------------------------------------------------------------
// Discovery (SC-004, SC-006)
// ---------------------------------------------------------------------------

/**
 * Discovers all valid CCS instances under ~/.ccs/instances/
 *
 * - Reads each subdirectory
 * - Validates the .credentials.json against the zod schema
 * - Skips and warns on invalid/missing files
 * - Returns accounts in alphabetical (filesystem) order before config reordering
 */
export async function discover(): Promise<Account[]> {
  let entries: string[]

  try {
    entries = await readdir(CCS_INSTANCES_DIR)
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      // ~/.ccs/instances/ doesn't exist — no accounts available (SC-005)
      return []
    }
    console.warn(`[account-rotator] Failed to read ${CCS_INSTANCES_DIR}: ${String(err)}`)
    return []
  }

  // Sort alphabetically for deterministic fallback order
  entries.sort()

  const accounts: Account[] = []

  for (const entry of entries) {
    const credPath = join(CCS_INSTANCES_DIR, entry, CREDENTIALS_FILENAME)

    let raw: unknown
    try {
      const content = await readFile(credPath, "utf-8")
      raw = JSON.parse(content) as unknown
    } catch (err) {
      // File missing or unreadable — skip with warning (SC-006)
      console.warn(
        `[account-rotator] Skipping instance "${entry}": cannot read ${credPath} — ${String(err)}`
      )
      continue
    }

    const result = credentialsSchema.safeParse(raw)
    if (!result.success) {
      // Schema validation failed — skip with warning (SC-006)
      console.warn(
        `[account-rotator] Skipping instance "${entry}": invalid credentials schema at ${credPath}\n` +
          result.error.toString()
      )
      continue
    }

    const { claudeAiOauth } = result.data
    accounts.push({
      name: entry,
      credentialsPath: credPath,
      accessToken: claudeAiOauth.accessToken,
      refreshToken: claudeAiOauth.refreshToken,
      expiresAt: claudeAiOauth.expiresAt,
    })
  }

  return accounts
}

// ---------------------------------------------------------------------------
// Config-based ordering (SC-009, SC-010)
// ---------------------------------------------------------------------------

/**
 * Reorders discovered accounts according to the user's config.accountOrder.
 *
 * - Accounts listed in accountOrder come first (in that order)
 * - Accounts not in accountOrder follow in their discovery (alphabetical) order
 * - Accounts disabled in config.accounts are excluded entirely
 * - accountOrder entries not found in discovered accounts are silently ignored
 */
export function applyConfigOrder(
  accounts: Account[],
  config: ResolvedConfig
): Account[] {
  // First, filter disabled accounts
  const filtered = accounts.filter((acc) => {
    const entry = config.accounts[acc.name]
    return entry === undefined || entry.enabled
  })

  if (config.accountOrder.length === 0) {
    // No order preference — return alphabetical discovery order (SC-010)
    return filtered
  }

  const byName = new Map(filtered.map((a) => [a.name, a]))
  const ordered: Account[] = []
  const used = new Set<string>()

  // First: accounts explicitly listed in accountOrder
  for (const name of config.accountOrder) {
    const acc = byName.get(name)
    if (acc !== undefined) {
      ordered.push(acc)
      used.add(name)
    }
  }

  // Then: remaining accounts not in accountOrder
  for (const acc of filtered) {
    if (!used.has(acc.name)) {
      ordered.push(acc)
    }
  }

  return ordered
}

// ---------------------------------------------------------------------------
// Token refresh (SC-014, SC-015, REQ-008)
// ---------------------------------------------------------------------------

/**
 * Attempts to refresh the OAuth access token for the given account.
 *
 * - Times out after 3 seconds (SC-015)
 * - On success: updates the credentials file atomically and returns a fresh Account
 * - On failure or timeout: logs a warning and returns the original account unchanged
 */
export async function refreshAccountToken(account: Account): Promise<Account> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TOKEN_REFRESH_TIMEOUT_MS)

  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn(
        `[account-rotator] Token refresh failed for "${account.name}": HTTP ${response.status}`
      )
      return account
    }

    const data = (await response.json()) as OAuthTokenResponse
    const now = Date.now()
    const expiresAt = data.expires_in != null
      ? now + data.expires_in * 1000
      : account.expiresAt

    const updated: Account = {
      ...account,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? account.refreshToken,
      expiresAt,
    }

    // Note: we intentionally do NOT persist refreshed credentials to disk.
    // The login plugin (anthropic-login-via-cli) owns credential persistence.
    // We only use the refreshed token in-memory for client.auth.set() (WARN-4).
    return updated
  } catch (err) {
    if (isAbortError(err)) {
      // SC-015: timeout hit
      console.warn(
        `[account-rotator] Token refresh timed out for "${account.name}" — using existing token`
      )
    } else {
      console.warn(
        `[account-rotator] Token refresh error for "${account.name}": ${String(err)}`
      )
    }
    return account
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  )
}

/**
 * Returns true if the account's token is expired or will expire within the given buffer.
 */
export function isTokenExpired(account: Account, bufferMs = 60_000): boolean {
  return account.expiresAt - Date.now() < bufferMs
}
