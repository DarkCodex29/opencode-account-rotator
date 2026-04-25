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
} from "./credential-store.js"
import {
  RotationEngine,
  createEmptyState,
  parseRetryAfter,
} from "./rotation-engine.js"
import { loadState, saveState } from "./state.js"
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

  // --- Step 6: Write initial state so TUI can display accounts immediately ---
  await saveState(engine.getState())

  notify(
    `✅ Account Rotator: loaded ${accounts.length} account(s) — ${accounts.map((a) => a.name).join(", ")}`,
    config.notifyOnRotation
  )

  // ---------------------------------------------------------------------------
  // Event hook — intercepts session.error for 429 detection (REQ-001, SC-001, SC-002)
  // ---------------------------------------------------------------------------

  return {
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
  console.log(`[account-rotator toast] ${message}`)
}

/** General informational log (startup, status) */
function notify(message: string, enabled: boolean): void {
  if (!enabled) return
  console.log(`[account-rotator] ${message}`)
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
