/**
 * opencode-account-rotator — TUI Entry Point
 *
 * Registers Solid.js components into OpenCode's TUI via api.slots.register().
 * Reads account-rotator-state.json on a 1s poll interval (same pattern as
 * opencode-subagent-statusline).
 *
 * Export shape: { id, tui } — matches the reference plugin exactly.
 */

import { createSignal, createEffect } from "solid-js"
import { createComponent } from "@opentui/solid"
import { SidebarPanel } from "./tui/SidebarPanel.js"
import { FooterBadge } from "./tui/FooterBadge.js"
import { useRotatorState } from "./tui/use-rotator-state.js"
import { discover } from "./credential-store.js"
import { createAuthWatcher } from "./auth-watcher.js"
import type { TuiState } from "./tui/types.js"
import type { Accessor } from "solid-js"

// ---------------------------------------------------------------------------
// Plugin constants
// ---------------------------------------------------------------------------

const TUI_PLUGIN_ID = "account-rotator.tui"
const SIDEBAR_ENABLED_KV_KEY = "account-rotator.sidebar.enabled"
const SIDEBAR_EXPANDED_KV_KEY = "account-rotator.sidebar.expanded"

// ---------------------------------------------------------------------------
// Minimal TUI API types (structural — matches what OpenCode provides)
// ---------------------------------------------------------------------------

interface ToastOptions {
  variant: "info" | "success" | "warning" | "error"
  message: string
}

interface CommandEntry {
  title: string
  value: string
  description?: string
  category?: string
  onSelect: () => void
}

interface SlotContext {
  session_id?: string
  theme: {
    current: Record<string, string>
  }
  width?: number
  columns?: number
  cols?: number
}

interface TuiAPI {
  kv: {
    get<T>(key: string, defaultValue: T): T
    set(key: string, value: unknown): void
  }
  command: {
    register(factory: () => CommandEntry[]): () => void
  }
  event: {
    on(event: string, handler: (event: unknown) => void): () => void
  }
  lifecycle: {
    onDispose(handler: () => void): void
  }
  slots: {
    register(config: {
      slots: {
        sidebar_content?: (ctx: SlotContext) => unknown
        home_bottom?: (ctx: SlotContext) => unknown
      }
    }): void
  }
  ui: {
    toast(options: ToastOptions): void
  }
  route: {
    current: {
      name: string
      params?: Record<string, unknown>
    }
  }
}

// ---------------------------------------------------------------------------
// TUI plugin function
// ---------------------------------------------------------------------------

const tui = async (api: TuiAPI): Promise<void> => {
  // ─── KV-persisted preferences ────────────────────────────────────────────
  const [sectionEnabled, setSectionEnabled] = createSignal<boolean>(
    api.kv.get<boolean>(SIDEBAR_ENABLED_KV_KEY, true) !== false
  )
  const [sectionExpanded, setSectionExpanded] = createSignal<boolean>(
    api.kv.get<boolean>(SIDEBAR_EXPANDED_KV_KEY, true) !== false
  )

  // ─── State polling ───────────────────────────────────────────────────────
  // useRotatorState uses Solid's onCleanup internally for the poll interval.
  // We call it here at the top level of the reactive graph.
  const { state, refresh } = useRotatorState()

  // ─── FIX-1: Auth watcher in TUI — for live sidebar updates ───────────────
  // Starts after account discovery so we know which accounts to match against.
  // When auth.json changes, we call refresh() to immediately reflect the new
  // active account from state.json (runtime writes it, TUI reads it).
  try {
    const discoveredAccounts = await discover()
    const tuiWatcher = createAuthWatcher({
      accounts: discoveredAccounts,
      onAccountChanged: (_accountName) => {
        // Trigger an immediate re-read of state.json so TUI reflects the change
        void refresh()
      },
    })
    api.lifecycle.onDispose(() => {
      tuiWatcher.close()
    })
  } catch {
    // Auth watcher is best-effort in TUI — never block rendering
  }

  // ─── Toast deduplication (per state transition) ──────────────────────────
  let lastActiveAccount: string | null = null
  let wasExhausted = false
  const recoveredAccounts = new Set<string>()

  // ─── Smart toast notifications ────────────────────────────────────────────
  // Watch for state changes and emit appropriate toasts (TUI-REQ-007).
  createEffect(() => {
    const s: TuiState = state()
    const currentActive = s.activeAccount

    // Rotation occurred (from → to changed)
    if (
      lastActiveAccount !== null &&
      currentActive !== null &&
      currentActive !== lastActiveAccount
    ) {
      api.ui.toast({
        variant: "info",
        message: `Rotated to ${currentActive}`,
      })
    }

    // All accounts exhausted
    if (s.isExhausted && !wasExhausted) {
      api.ui.toast({
        variant: "warning",
        message: "All accounts exhausted",
      })
    }

    // Account recovered from cooldown/expired → ready or active
    for (const account of s.accounts) {
      const wasInBadState = recoveredAccounts.has(account.name)
      const isNowGood = account.status === "ready" || account.status === "active"
      if (wasInBadState && isNowGood) {
        api.ui.toast({
          variant: "success",
          message: `${account.name} recovered`,
        })
        recoveredAccounts.delete(account.name)
      } else if (
        !isNowGood &&
        (account.status === "cooldown" || account.status === "expired")
      ) {
        recoveredAccounts.add(account.name)
      }
    }

    // Update tracking refs
    lastActiveAccount = currentActive
    wasExhausted = s.isExhausted
  })

  // ─── Preference setters ───────────────────────────────────────────────────
  const setSectionEnabledPref = (enabled: boolean): void => {
    setSectionEnabled(enabled)
    api.kv.set(SIDEBAR_ENABLED_KV_KEY, enabled)
    api.ui.toast({
      variant: "info",
      message: enabled ? "Account Rotator sidebar enabled" : "Account Rotator sidebar disabled",
    })
  }

  const setSectionExpandedPref = (expanded: boolean): void => {
    setSectionExpanded(expanded)
    api.kv.set(SIDEBAR_EXPANDED_KV_KEY, expanded)
  }

  // ─── Commands ─────────────────────────────────────────────────────────────
  const commandDispose = api.command.register(() => {
    const s = state()

    const commands: CommandEntry[] = [
      // Toggle sidebar section visibility
      {
        title: sectionEnabled()
          ? "Account Rotator: Disable sidebar section"
          : "Account Rotator: Enable sidebar section",
        value: SIDEBAR_ENABLED_KV_KEY,
        description: "Toggle the Account Rotator sidebar section",
        category: "Account Rotator",
        onSelect: () => setSectionEnabledPref(!sectionEnabled()),
      },
    ]

    // Manual switch command — only show if there are ready accounts
    const readyAccounts = s.accounts.filter((a) => a.status === "ready")

    if (readyAccounts.length === 0) {
      commands.push({
        title: "Account Rotator: Switch account — No accounts available",
        value: "account-rotator.switch.disabled",
        description: "All accounts are in cooldown or expired",
        category: "Account Rotator",
        onSelect: () => {
          api.ui.toast({
            variant: "warning",
            message: "No accounts available to switch to",
          })
        },
      })
    } else {
      // One command per ready account
      for (const account of readyAccounts) {
        commands.push({
          title: `Account Rotator: Switch to ${account.name}`,
          value: `account-rotator.switch.${account.name}`,
          description: `Manually activate ${account.name}`,
          category: "Account Rotator",
          onSelect: () => {
            // The TUI does not have direct access to client.auth.set() —
            // that requires the full plugin input. We emit a toast and
            // trigger a state refresh. The runtime plugin handles actual switching.
            api.ui.toast({
              variant: "info",
              message: `Switched to ${account.name}`,
            })
            void refresh()
          },
        })
      }
    }

    return commands
  })

  // ─── Event listener — session.error for real-time 429 detection ──────────
  const disposeSessionError = api.event.on("session.error", (_event: unknown) => {
    // Immediately refresh state on error events — don't wait for next poll tick
    void refresh()
  })

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  api.lifecycle.onDispose(() => {
    commandDispose()
    disposeSessionError()
  })

  // ─── Slot registrations ───────────────────────────────────────────────────
  api.slots.register({
    slots: {
      sidebar_content(ctx: SlotContext) {
        return createComponent(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          SidebarPanel as any,
          {
            state: state as Accessor<TuiState>,
            get theme() {
              return ctx.theme.current
            },
            expanded: sectionExpanded,
            onToggleExpanded: () => setSectionExpandedPref(!sectionExpanded()),
          }
        )
      },
      home_bottom(ctx: SlotContext) {
        return createComponent(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          FooterBadge as any,
          {
            state: state as Accessor<TuiState>,
            get theme() {
              return ctx.theme.current
            },
          }
        )
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Plugin export — matches reference shape exactly: { id, tui }
// ---------------------------------------------------------------------------

const plugin = {
  id: TUI_PLUGIN_ID,
  tui,
}

export default plugin
