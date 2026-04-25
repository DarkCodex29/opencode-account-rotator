/**
 * useRotatorState — Solid.js reactive hook for the account rotator TUI.
 *
 * Polls account-rotator-state.json every 1 000 ms and derives a TuiState
 * from the raw PersistedState. Clears the interval on dispose.
 *
 * Returns [Accessor<TuiState>, { refresh }]
 */

import { createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import { readFile } from "node:fs/promises"
import { STATE_PATH } from "../state.js"
import type { PersistedState } from "../types.js"
import type { AccountDisplay, TuiState } from "./types.js"
import type { AccountDisplayStatus } from "../types.js"
import { emptyTuiState } from "./types.js"

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derives an AccountDisplayStatus from the persisted state for a given account.
 * Health statuses from startup probes take precedence over "ready" fallback.
 */
function deriveStatus(
  name: string,
  activeAccount: string | null,
  cooldowns: PersistedState["cooldowns"],
  disabledNames: Set<string>,
  now: number,
  healthStatuses: Record<string, string>
): AccountDisplayStatus {
  if (disabledNames.has(name)) return "disabled"
  if (name === activeAccount) return "active"

  const cooldown = cooldowns.find((c) => c.account === name)
  if (cooldown) {
    if (cooldown.until > now) return "cooldown"
    // Cooldown expired — fall through to health status check
  }

  // FIX-2: Use health probe result from runtime if available
  const health = healthStatuses[name]
  if (health === "exhausted") return "exhausted"
  if (health === "unknown") return "unknown"

  return "ready"
}

/**
 * Derives a TuiState from the raw PersistedState JSON.
 */
function deriveState(raw: PersistedState): TuiState {
  const now = Date.now()
  const healthStatuses = raw.healthStatuses ?? {}

  const accounts: AccountDisplay[] = raw.accounts.map((name) => {
    const cooldown = raw.cooldowns.find((c) => c.account === name)
    const cooldownUntil =
      cooldown && cooldown.until > now ? cooldown.until : null

    const status = deriveStatus(
      name,
      raw.activeAccount,
      raw.cooldowns,
      new Set<string>(), // disabled accounts not tracked in PersistedState; extend later
      now,
      healthStatuses
    )

    return {
      name,
      status,
      cooldownUntil,
      isActive: name === raw.activeAccount,
    }
  })

  // isExhausted: no account is active or ready
  const isExhausted =
    accounts.length > 0 &&
    accounts.every(
      (a) => a.status === "cooldown" || a.status === "expired" || a.status === "disabled" || a.status === "exhausted"
    )

  return {
    accounts,
    activeAccount: raw.activeAccount,
    lastRotation: raw.lastRotation,
    history: [], // PersistedState does not include history — in-memory only
    updatedAt: new Date().toISOString(),
    isExhausted,
    healthStatuses,
  }
}

/**
 * Parses raw JSON from state file. Returns null on invalid input.
 */
function parsePersistedState(content: string): PersistedState | null {
  try {
    const raw = JSON.parse(content) as unknown

    if (
      raw === null ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      return null
    }

    const obj = raw as Record<string, unknown>

    // Minimal validation — enough to safely derive TuiState
    if (
      !Array.isArray(obj["accounts"]) ||
      !Array.isArray(obj["cooldowns"])
    ) {
      return null
    }

    // Parse healthStatuses — optional Record<string, string>
    let healthStatuses: Record<string, import("../types.js").HealthStatus> | undefined
    const rawHealth = obj["healthStatuses"]
    if (rawHealth !== null && typeof rawHealth === "object" && !Array.isArray(rawHealth)) {
      healthStatuses = {}
      const validStatuses = new Set(["ready", "exhausted", "unknown", "unchecked"])
      for (const [k, v] of Object.entries(rawHealth as Record<string, unknown>)) {
        if (typeof v === "string" && validStatuses.has(v)) {
          healthStatuses[k] = v as import("../types.js").HealthStatus
        }
      }
    }

    const parsed: PersistedState = {
      activeAccount:
        typeof obj["activeAccount"] === "string" ? obj["activeAccount"] : null,
      accounts: (obj["accounts"] as unknown[]).filter(
        (a): a is string => typeof a === "string"
      ),
      rotationIndex:
        typeof obj["rotationIndex"] === "number" ? obj["rotationIndex"] : 0,
      cooldowns: Array.isArray(obj["cooldowns"])
        ? (obj["cooldowns"] as unknown[]).filter(
            (c): c is { account: string; until: number; reason: "429" | "401" | "refresh-failed" } =>
              c !== null &&
              typeof c === "object" &&
              !Array.isArray(c) &&
              typeof (c as Record<string, unknown>)["account"] === "string" &&
              typeof (c as Record<string, unknown>)["until"] === "number"
          )
        : [],
      lastRotation:
        typeof obj["lastRotation"] === "number" ? obj["lastRotation"] : null,
    }
    // Only set optional field if it was parsed — satisfies exactOptionalPropertyTypes
    if (healthStatuses !== undefined) {
      parsed.healthStatuses = healthStatuses
    }
    return parsed
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseRotatorStateResult {
  /** Reactive accessor for the current TUI state */
  state: Accessor<TuiState>
  /** Force an immediate re-read of the state file */
  refresh: () => Promise<void>
}

/**
 * Solid.js hook that polls STATE_PATH every 1 000 ms.
 *
 * - Returns a reactive [state, { refresh }] tuple
 * - Clears the interval on component unmount via onCleanup
 * - Missing/invalid file → returns emptyTuiState()
 */
export function useRotatorState(): UseRotatorStateResult {
  const [state, setState] = createSignal<TuiState>(emptyTuiState())

  const refresh = async (): Promise<void> => {
    try {
      const content = await readFile(STATE_PATH, "utf-8")
      const parsed = parsePersistedState(content)
      if (parsed !== null) {
        setState(deriveState(parsed))
      }
    } catch (err: unknown) {
      // File missing or unreadable — keep current state (or reset to empty)
      const isNodeError = (e: unknown): e is { code: string } =>
        e instanceof Error && "code" in e
      if (isNodeError(err) && err.code === "ENOENT") {
        setState(emptyTuiState())
      }
      // Other errors: keep last known state
    }
  }

  // Initial read
  void refresh()

  // Poll every 1 s
  const intervalId = setInterval(() => {
    void refresh()
  }, 1_000)

  onCleanup(() => {
    clearInterval(intervalId)
  })

  return { state, refresh }
}
