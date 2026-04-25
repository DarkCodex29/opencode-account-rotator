/**
 * FooterBadge — compact one-liner for the home_bottom slot.
 *
 * Renders:
 *   ⚡ {ActiveName} ({N} ready · {M} cooldown HH:MM)
 *   or:
 *   ⚠ No active account
 *
 * Follows HomeBottomStatus pattern from opencode-subagent-statusline.
 */

import { Show, createMemo, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { TuiState } from "./types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FooterBadgeProps {
  state: Accessor<TuiState>
  theme: Record<string, string>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FooterBadge(props: FooterBadgeProps) {
  // Live tick for cooldown countdown
  const [nowMs, setNowMs] = createSignal(Date.now())
  const tick = setInterval(() => setNowMs(Date.now()), 1_000)
  onCleanup(() => clearInterval(tick))

  const activeAccount = createMemo(() => props.state().activeAccount)
  const isExhausted = createMemo(() => props.state().isExhausted)

  const readyCount = createMemo(
    () => props.state().accounts.filter((a) => a.status === "ready").length
  )

  const cooldownAccounts = createMemo(() =>
    props.state().accounts.filter((a) => a.status === "cooldown")
  )

  const cooldownCount = createMemo(() => cooldownAccounts().length)

  // Shortest cooldown for the footer badge display
  const shortestCooldownText = createMemo(() => {
    const now = nowMs()
    const shortest = cooldownAccounts()
      .map((a) => (a.cooldownUntil !== null ? a.cooldownUntil - now : Infinity))
      .filter((ms) => ms > 0)
      .reduce((min, ms) => Math.min(min, ms), Infinity)

    if (!isFinite(shortest)) return ""
    return ` ${formatCountdown(shortest)}`
  })

  const visible = createMemo(
    () => props.state().accounts.length > 0
  )

  return (
    <Show when={visible()}>
      <box paddingLeft={1} paddingRight={1}>
        <Show
          when={!isExhausted() && activeAccount() !== null}
          fallback={
            <box flexDirection="row">
              <text fg={props.theme["warning"] ?? "yellow"}>⚠ No active account</text>
            </box>
          }
        >
          <box flexDirection="row">
            <text fg={props.theme["success"] ?? "green"}>⚡ {activeAccount()}</text>
            <text fg={props.theme["textMuted"] ?? "gray"}>
              {" "}({readyCount()} ready
            </text>
            <Show when={cooldownCount() > 0}>
              <text fg={props.theme["textMuted"] ?? "gray"}>
                {" · "}{cooldownCount()} cooldown{shortestCooldownText()}
              </text>
            </Show>
            <text fg={props.theme["textMuted"] ?? "gray"}>)</text>
          </box>
        </Show>
      </box>
    </Show>
  )
}
