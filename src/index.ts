/**
 * opencode-account-rotator — Plugin Entry Point
 *
 * Complements anthropic-login-via-cli@1.6.0 by adding:
 * 1. Round-robin fairness (accounts rotate in configured order)
 * 2. Per-account cooldown windows (Retry-After header respected)
 * 3. TUI toast notifications on rotation and exhaustion
 * 4. Rotation history tracking (in-memory per session)
 * 5. State persistence across restarts (rotationIndex + cooldowns)
 *
 * This plugin NEVER writes to auth.json directly.
 * All credential swaps go through client.auth.set() only (REQ-007, SC-012, SC-013).
 */

import { loadConfig } from "./config.js"
import {
  discover,
  applyConfigOrder,
  refreshAccountToken,
  isTokenExpired,
  readAuthJson,
  rediscoverAccount,
} from "./credential-store.js"
import {
  RotationEngine,
  createEmptyState,
  parseRetryAfter,
} from "./rotation-engine.js"
import { loadState, saveState } from "./state.js"
import { matchTokenToAccount, createAuthWatcher } from "./auth-watcher.js"
import { debugLog } from "./debug-log.js"
import type { Account, RotationState } from "./types.js"

// ---------------------------------------------------------------------------
// Plugin type stubs
// (In production OpenCode loads this dynamically — types are structural)
// These match the REAL OpenCode plugin API shape for client.auth.set()
// ---------------------------------------------------------------------------

interface PluginInput {
  client: {
    auth: {
      set(opts: {
        path: { id: string }
        body: { type: "oauth"; access: string; refresh: string; expires: number }
      }): Promise<void>
    }
  }
  directory: string
}

// OpenCode event shape (minimal — we only need session.error)
interface SessionErrorEvent {
  type: "session.error"
  properties?: {
    error?: {
      statusCode?: number
      message?: string
      headers?: Record<string, string>
    }
  }
}

type AnyEvent = SessionErrorEvent | { type: string }

type PluginHooks = {
  event?: (context: { event: AnyEvent }) => void | Promise<void>
  dispose?: () => void | Promise<void>
}

type Plugin = (input: PluginInput) => PluginHooks | Promise<PluginHooks>

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

const plugin: Plugin = async (input: PluginInput): Promise<PluginHooks> => {
  const { client } = input

  // --- Step 1: Load config ---
  const config = await loadConfig()

  // --- Step 2: Discover CCS accounts ---
  let accounts: Account[] = await discover()
  accounts = applyConfigOrder(accounts, config)

  // --- Step 3: Load persisted state ---
  const persisted = await loadState()
  const initialState: RotationState = {
    ...persisted,
    history: [], // in-memory only — starts empty every session (SC-018)
  }

  // --- Step 4: Initialize rotation engine ---
  const engine = new RotationEngine(config, initialState)
  engine.setAccounts(accounts)
  engine.restoreState(persisted)

  // --- Step 5: Handle no accounts found (SC-005) ---
  if (accounts.length === 0) {
    notify(
      "Account Rotator: no CCS instances found",
      config.notifyOnRotation
    )
    // Stay loaded but inactive — event hook will be a no-op
    return {
      event: async () => {
        // No accounts — nothing to rotate
      },
    }
  }

  // --- FIX-4: Startup auth sync — read auth.json and set correct activeAccount ---
  // Must happen BEFORE writing initial state so TUI sees the correct active account.
  const authData = await readAuthJson()
  if (authData !== null) {
    const matchedName = matchTokenToAccount(authData.access, accounts)
    if (matchedName !== null) {
      // restoreState() mutates internal engine state directly
      engine.restoreState({ activeAccount: matchedName })
      notify(
        `[account-rotator] Startup auth sync: active account set to "${matchedName}"`,
        config.notifyOnRotation
      )
    } else {
      debugLog(
        "[account-rotator] Startup auth sync: auth.json token does not match any known CCS account"
      )
    }
  }

  // --- Step 6: Write initial state so TUI can display accounts immediately ---
  await saveState(engine.getState())

  // --- FIX-1: Start auth watcher for live rotation detection ---
  const authWatcher = createAuthWatcher({
    accounts,
    onAccountChanged: async (accountName) => {
      const previousAccount = engine.getState().activeAccount

      // --- Case 1: Token matched a known account ---
      if (accountName !== null) {
        if (accountName !== previousAccount) {
          engine.restoreState({ activeAccount: accountName })
          await saveState(engine.getState())
          notify(
            `[account-rotator] Auth watcher: active account changed to "${accountName}"`,
            config.notifyOnRotation
          )
        }
        return
      }

      // --- Case 2: Token did NOT match any known account (accountName === null) ---
      //
      // This happens when the login plugin refreshes a token — the new token
      // doesn't match the stale in-memory snapshots loaded at startup.
      //
      // Strategy:
      // 1. Try to re-discover fresh tokens from disk for all accounts and
      //    match again. If we find a match, update in-memory state and return.
      // 2. If still no match, treat this as the current account being logged
      //    out / rate-limited and attempt active rotation.

      debugLog(
        `[account-rotator] Auth watcher: token did not match any known account — attempting re-discovery`
      )

      // Step 2a: re-read credentials from disk and try matching again
      const authData = await readAuthJson()
      if (authData !== null) {
        for (const acc of accounts) {
          const fresh = await rediscoverAccount(acc.name)
          if (fresh !== null && fresh.accessToken === authData.access) {
            // Update the in-memory snapshot so future comparisons work
            acc.accessToken = fresh.accessToken
            acc.refreshToken = fresh.refreshToken
            acc.expiresAt = fresh.expiresAt

            if (fresh.name !== previousAccount) {
              engine.restoreState({ activeAccount: fresh.name })
              await saveState(engine.getState())
              notify(
                `[account-rotator] Auth watcher: re-discovered token matches "${fresh.name}" — updating active account`,
                config.notifyOnRotation
              )
            } else {
              debugLog(
                `[account-rotator] Auth watcher: re-discovered token still matches "${fresh.name}" (token was refreshed in-place)`
              )
            }
            return
          }
        }
      }

      // Step 2b: no match even after re-discovery — treat current account as rate-limited
      // and actively rotate to the next available account.
      debugLog(
        `[account-rotator] Auth watcher: active account changed to "null" — initiating active rotation`
      )

      // Mark previous account in cooldown (it triggered a login-plugin swap)
      if (previousAccount !== null) {
        engine.markCooldown(previousAccount, config.cooldownMs, "429")
      }

      // Check exhaustion first
      if (engine.isExhausted()) {
        const waitSec = Math.ceil(engine.shortestCooldownMs() / 1000)
        notify(
          `[account-rotator] Auth watcher: all accounts exhausted — retry in ${waitSec}s`,
          config.notifyOnRotation
        )
        engine.scheduleReEnable(() => {
          notify(
            "🔄 Account Rotator: cooldown expired — accounts available again",
            config.notifyOnRotation
          )
        })
        await saveState(engine.getState())
        return
      }

      try {
        // Rotate to the next account (previousAccount already marked above)
        const next = await engine.rotate(null, "429")

        if (next === null) {
          const waitSec = Math.ceil(engine.shortestCooldownMs() / 1000)
          notify(
            `[account-rotator] Auth watcher: all accounts exhausted after rotation — retry in ${waitSec}s`,
            config.notifyOnRotation
          )
          engine.scheduleReEnable(() => {
            notify(
              "🔄 Account Rotator: cooldown expired — accounts available again",
              config.notifyOnRotation
            )
          })
          await saveState(engine.getState())
          return
        }

        // Refresh token if expired before activating
        let accountToActivate = next
        if (isTokenExpired(next)) {
          accountToActivate = await refreshAccountToken(next)
        }

        // Activate via client.auth.set() — NEVER write auth.json directly (REQ-007)
        await client.auth.set({
          path: { id: "anthropic" },
          body: {
            type: "oauth",
            access: accountToActivate.accessToken,
            refresh: accountToActivate.refreshToken,
            expires: accountToActivate.expiresAt,
          },
        })

        await saveState(engine.getState())

        const allAccounts = engine.getAccounts()
        const idx = allAccounts.findIndex((a) => a.name === accountToActivate.name) + 1
        notify(
          `🔄 [account-rotator] Auth watcher: rotated to ${accountToActivate.name} (${idx}/${allAccounts.length})`,
          config.notifyOnRotation
        )
      } catch (err) {
        debugLog(
          `[account-rotator] Auth watcher: active rotation failed — ${String(err)}`
        )
      }
    },
  })

  notify(
    `✅ Account Rotator: loaded ${accounts.length} account(s) — ${accounts.map((a) => a.name).join(", ")}`,
    config.notifyOnRotation
  )

  // ---------------------------------------------------------------------------
  // Event hook — intercepts session.error for 429 detection (REQ-001, SC-001, SC-002)
  // Auth watcher (FIX-1) is the PRIMARY detection mechanism.
  // session.error hook kept as SECONDARY fallback — do NOT remove.
  // ---------------------------------------------------------------------------

  return {
    dispose: () => {
      authWatcher.close()
    },
    event: async ({ event }) => {
      // Only handle session.error events
      if (event.type !== "session.error") return

      const err = (event as SessionErrorEvent).properties?.error
      if (err == null) return

      // SC-002: Non-429 errors MUST NOT trigger rotation
      if (err.statusCode !== 429) return

      // Engine already handles the mutex guard (SC-019, REQ-011)
      const fromAccount = engine.getState().activeAccount
      const retryAfterHeader = err.headers?.["retry-after"] ?? err.headers?.["Retry-After"]
      const retryAfterMs = parseRetryAfter(retryAfterHeader)

      // Check if all accounts are exhausted BEFORE attempting rotation
      if (engine.isExhausted()) {
        const waitSec = Math.ceil(engine.shortestCooldownMs() / 1000)
        notifyToast(
          `⛔ All accounts exhausted. Retry in ${waitSec}s`,
          config.notifyOnRotation
        )
        // Schedule automatic re-enable (SC-011)
        engine.scheduleReEnable(() => {
          notify(
            "🔄 Account Rotator: cooldown expired — accounts available again",
            config.notifyOnRotation
          )
        })
        return
      }

      // --- Rotate ---
      const next = await engine.rotate(fromAccount, "429", retryAfterMs)

      if (next === null) {
        // All accounts exhausted after this rotation attempt
        const waitSec = Math.ceil(engine.shortestCooldownMs() / 1000)
        notifyToast(
          `⛔ All accounts exhausted. Retry in ${waitSec}s`,
          config.notifyOnRotation
        )
        engine.scheduleReEnable(() => {
          notify(
            "🔄 Account Rotator: cooldown expired — accounts available again",
            config.notifyOnRotation
          )
        })
        return
      }

      // --- Token refresh before activation (REQ-008, SC-014, SC-015) ---
      let accountToUse = next
      if (isTokenExpired(next)) {
        accountToUse = await refreshAccountToken(next)
      }

      // --- Activate credentials (REQ-002, SC-003) ---
      // Only client.auth.set() — NEVER write to auth.json (REQ-007, SC-012, SC-013)
      await client.auth.set({
        path: { id: "anthropic" },
        body: {
          type: "oauth",
          access: accountToUse.accessToken,
          refresh: accountToUse.refreshToken,
          expires: accountToUse.expiresAt,
        },
      })

      // --- Persist state (REQ-009) ---
      await saveState(engine.getState())

      // --- TUI toast (REQ-004, SC-007) ---
      const allAccounts = engine.getAccounts()
      const idx = allAccounts.findIndex((a) => a.name === accountToUse.name) + 1

      notifyToast(
        `🔄 Rate limit hit — switched to ${accountToUse.name} (${idx}/${allAccounts.length})`,
        config.notifyOnRotation
      )
    },
  }
}

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

/**
 * Emits a TUI toast notification.
 *
 * The OpenCode plugin API may not expose a toast API — we use console.log
 * with a distinctive emoji prefix so it surfaces in the TUI output area.
 * If a future plugin API adds toast support, this is the single place to update.
 */
function notifyToast(message: string, enabled: boolean): void {
  if (!enabled) return
  debugLog(`[account-rotator toast] ${message}`)
}

/** General informational log (startup, status) */
function notify(message: string, enabled: boolean): void {
  if (!enabled) return
  debugLog(`[account-rotator] ${message}`)
}

// ---------------------------------------------------------------------------
// Plugin export (OpenCode plugin shape)
// ---------------------------------------------------------------------------

export default {
  id: "account-rotator",
  server: plugin,
}

/**
 * Named export for testing and direct usage.
 */
export { plugin }

/**
 * Re-export types and utilities for consumers who want to extend the plugin.
 */
export type { Account, ResolvedConfig, PluginConfig } from "./types.js"
export { parseRetryAfter, createEmptyState } from "./rotation-engine.js"
export { loadConfig } from "./config.js"
export { discover, applyConfigOrder } from "./credential-store.js"
export { loadState, saveState } from "./state.js"
export { RotationEngine } from "./rotation-engine.js"
