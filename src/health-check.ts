/**
 * Health Check for opencode-account-rotator.
 *
 * Probes each CCS account against the Anthropic Messages API to determine
 * if the account's quota is available.
 *
 * Uses OAuth Bearer auth (Claude Max OAuth), NOT x-api-key.
 * Sends the cheapest possible probe: claude-haiku-4, max_tokens=1.
 *
 * Result mapping:
 *   HTTP 200 → "ready"
 *   HTTP 429 → "exhausted"
 *   timeout / network error → "unknown"
 */

import type { Account, HealthStatus } from "./types.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
const ANTHROPIC_API_VERSION = "2023-06-01"
const PROBE_MODEL = "claude-haiku-4"
const PROBE_MAX_TOKENS = 1
const PROBE_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// Single account probe (Task 3.1)
// ---------------------------------------------------------------------------

/**
 * Probes a single account against the Anthropic Messages API.
 *
 * - Uses `Authorization: Bearer {accessToken}` (OAuth, not x-api-key)
 * - Times out after 5 seconds via AbortController
 * - Returns "ready" (200), "exhausted" (429), or "unknown" (timeout/error)
 */
export async function probeAccount(account: Account): Promise<HealthStatus> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${account.accessToken}`,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: PROBE_MODEL,
        max_tokens: PROBE_MAX_TOKENS,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: controller.signal,
    })

    if (response.status === 200) {
      return "ready"
    }

    if (response.status === 429) {
      return "exhausted"
    }

    // Any other status (401, 403, 500, …) → treat as unknown
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
// All accounts in parallel (Task 3.2)
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
