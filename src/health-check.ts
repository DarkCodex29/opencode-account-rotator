/**
 * Health Check for opencode-account-rotator.
 *
 * IMPORTANT: OAuth tokens from Claude Max CANNOT be used directly against
 * api.anthropic.com (returns 401 "OAuth authentication not supported").
 * They only work through OpenCode's proxy layer.
 *
 * Strategy: Passive health check via token refresh.
 * - If token refresh succeeds → account is "ready" (valid subscription)
 * - If token refresh returns 403 → account is "exhausted" or suspended
 * - If token refresh returns 429 → rate limited on refresh endpoint (mark "unchecked")
 * - If timeout/error → "unknown"
 *
 * The REAL health status gets updated passively when the auth watcher
 * detects the login plugin rotating away from an account (→ "exhausted").
 */

import type { Account, HealthStatus } from "./types.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** OAuth client ID used by Claude Code CLI / anthropic-login-via-cli */
const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const PROBE_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// Single account probe
// ---------------------------------------------------------------------------

/**
 * Probes a single account by attempting a token refresh.
 *
 * This validates that the account's subscription is active and the refresh
 * token is valid. It does NOT consume message quota.
 *
 * Result mapping:
 *   200 (refresh succeeds) → "ready"
 *   403 (forbidden/suspended) → "exhausted"
 *   429 (refresh rate limited) → "unchecked" (can't determine)
 *   401 (invalid token) → "exhausted"
 *   timeout / network error → "unknown"
 */
export async function probeAccount(account: Account): Promise<HealthStatus> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }),
      signal: controller.signal,
    })

    if (response.status === 200) {
      // Token refreshed successfully → subscription is active
      // Update the account's tokens in memory (caller can persist if needed)
      try {
        const data = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
        if (data.access_token) {
          account.accessToken = data.access_token
        }
        if (data.refresh_token) {
          account.refreshToken = data.refresh_token
        }
        if (data.expires_in) {
          account.expiresAt = Date.now() + data.expires_in * 1000
        }
      } catch {
        // JSON parse failed — still mark as ready since HTTP 200
      }
      return "ready"
    }

    if (response.status === 429) {
      // Refresh endpoint is rate-limited — can't determine health
      return "unchecked"
    }

    if (response.status === 401 || response.status === 403) {
      // Token invalid or account suspended
      return "exhausted"
    }

    // Any other status → unknown
    console.warn(
      `[account-rotator] Health probe for "${account.name}" returned HTTP ${response.status} — marking unknown`
    )
    return "unknown"
  } catch (err) {
    if (isAbortError(err)) {
      console.warn(
        `[account-rotator] Health probe timed out for "${account.name}" — marking unknown`
      )
    } else {
      console.warn(
        `[account-rotator] Health probe error for "${account.name}": ${String(err)} — marking unknown`
      )
    }
    return "unknown"
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// All accounts in parallel
// ---------------------------------------------------------------------------

/**
 * Probes all given accounts in parallel.
 *
 * Returns a Map<accountName, HealthStatus>. All probes run simultaneously
 * via Promise.all — no probe blocks another.
 */
export async function probeAllAccounts(
  accounts: Account[]
): Promise<Map<string, HealthStatus>> {
  const results = await Promise.all(
    accounts.map(async (account) => {
      const status = await probeAccount(account)
      return [account.name, status] as const
    })
  )

  return new Map(results)
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  )
}
