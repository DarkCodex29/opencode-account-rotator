/**
 * SidebarPanel — Account Rotator sidebar component.
 *
 * Renders all configured accounts with status icons + labels + cooldown
 * countdowns, plus the last 5 rotation history entries.
 *
 * Follows the exact same JSX patterns as SidebarSubagents in the reference
 * (opencode-subagent-statusline/src/tui.tsx).
 */

import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { TuiState } from "./types.js"
import type { AccountDisplayStatus } from "../types.js"

// ---------------------------------------------------------------------------
// Status helpers (mirrors reference's statusIcon / statusColor)
// ---------------------------------------------------------------------------

function statusEmoji(status: AccountDisplayStatus): string {
  switch (status) {
    case "active":
      return "🟢"
    case "ready":
      return "🟢"
    case "cooldown":
      return "🟡"
    case "expired":
      return "🔴"
    case "disabled":
      return "⚫"
    case "exhausted":
      return "🔴"
    case "unknown":
      return "🟡"
  }
}

function statusLabel(status: AccountDisplayStatus): string {
  switch (status) {
    case "active":
      return "active"
    case "ready":
      return "ready"
    case "cooldown":
      return "cooldown"
    case "expired":
      return "expired"
    case "disabled":
      return "disabled"
    case "exhausted":
      return "exhausted"
    case "unknown":
      return "unknown"
  }
}

/**
 * Formats a remaining-ms value as MM:SS.
 */
function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

/**
 * Formats a Unix timestamp (ms) as a short human-readable string.
 */
function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SidebarPanelProps {
  state: Accessor<TuiState>
  theme: Record<string, string>
  expanded: Accessor<boolean>
  onToggleExpanded: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SidebarPanel(props: SidebarPanelProps) {
  // Live countdown tick — updates every 1s for cooldown display
  const [nowMs, setNowMs] = createSignal(Date.now())
  const tick = setInterval(() => setNowMs(Date.now()), 1_000)
  onCleanup(() => clearInterval(tick))

  const accounts = createMemo(() => props.state().accounts)
  const history = createMemo(() => props.state().history.slice(0, 5))

  const AccountRow = (rowProps: { name: string; status: AccountDisplayStatus; cooldownUntil: number | null }) => {
    const remaining = createMemo(() => {
      if (rowProps.status !== "cooldown" || rowProps.cooldownUntil === null) {
        return null
      }
      const r = rowProps.cooldownUntil - nowMs()
      return r > 0 ? r : null
    })

    const rowColor = (): string => {
      switch (rowProps.status) {
        case "active":
          return props.theme["success"] ?? "green"
        case "ready":
          return props.theme["text"] ?? ""
        case "cooldown":
          return props.theme["error"] ?? "red"
        case "expired":
          return props.theme["warning"] ?? "yellow"
        case "disabled":
          return props.theme["textMuted"] ?? "gray"
        case "exhausted":
          return props.theme["error"] ?? "red"
        case "unknown":
          return props.theme["warning"] ?? "yellow"
      }
    }

    return (
      <box flexDirection="column">
        <box flexDirection="row">
          <text fg={rowColor()}>
            {statusEmoji(rowProps.status)}{" "}
          </text>
          <text fg={rowColor()}>
            {rowProps.name}
          </text>
          <text fg={props.theme["textMuted"] ?? "gray"}>
            {" "}{statusLabel(rowProps.status)}
          </text>
          <Show when={remaining() !== null}>
            <text fg={props.theme["error"] ?? "red"}>
              {" "}{formatCountdown(remaining()!)}
            </text>
          </Show>
        </box>
      </box>
    )
  }

  const HistorySection = () => (
    <box flexDirection="column">
      <text fg={props.theme["textMuted"] ?? "gray"} selectable={false}>
        ─ Recent rotations
      </text>
      <Show
        when={history().length > 0}
        fallback={
          <text fg={props.theme["textMuted"] ?? "gray"}>  (none)</text>
        }
      >
        <For each={history()}>
          {(entry) => (
            <text fg={props.theme["textMuted"] ?? "gray"}>
              {formatTimestamp(entry.timestamp)} {entry.from ?? "–"} → {entry.to} ({entry.trigger})
            </text>
          )}
        </For>
      </Show>
    </box>
  )

  return (
    <box flexDirection="column">
      <text
        fg={props.theme["text"] ?? ""}
        selectable={false}
        onMouseDown={props.onToggleExpanded}
      >
        {props.expanded() ? "▾" : "▸"} Account Rotator
      </text>
      <Show when={props.expanded()}>
        <box flexDirection="column">
          <Show
            when={accounts().length > 0}
            fallback={
              <text fg={props.theme["textMuted"] ?? "gray"}>
                No accounts found
              </text>
            }
          >
            <For each={accounts()}>
              {(account) => (
                <AccountRow
                  name={account.name}
                  status={account.status}
                  cooldownUntil={account.cooldownUntil}
                />
              )}
            </For>
          </Show>
          <HistorySection />
        </box>
      </Show>
    </box>
  )
}
