/**
 * TUI-specific types for opencode-account-rotator.
 *
 * These types are consumed by the Solid.js TUI components and the
 * useRotatorState hook. They are derived from PersistedState at read time.
 */

import type { AccountDisplayStatus } from "../types.js"

// Re-export for convenience
export type { AccountDisplayStatus }

/**
 * A single account row as displayed in the TUI sidebar/footer.
 */
export interface AccountDisplay {
  /** CCS instance name */
  name: string
  /** Computed display status */
  status: AccountDisplayStatus
  /** Unix timestamp (ms) when cooldown expires. null if not in cooldown. */
  cooldownUntil: number | null
  /** Whether this is the currently active account */
  isActive: boolean
}

/**
 * The full TUI state derived from the persisted state file.
 * Returned by useRotatorState() and passed as a prop to components.
 */
export interface TuiState {
  /** All configured accounts with their current display status */
  accounts: AccountDisplay[]
  /** Name of the currently active account, or null if none */
  activeAccount: string | null
  /** Unix timestamp (ms) of the last rotation, or null */
  lastRotation: number | null
  /** Last 5 rotation history entries (most recent first) */
  history: Array<{
    timestamp: number
    from: string | null
    to: string
    trigger: string
  }>
  /** ISO timestamp when the state was last updated */
  updatedAt: string
  /** True if all accounts are in cooldown or expired */
  isExhausted: boolean
}

/**
 * The empty/default TUI state returned when the state file is missing.
 */
export function emptyTuiState(): TuiState {
  return {
    accounts: [],
    activeAccount: null,
    lastRotation: null,
    history: [],
    updatedAt: new Date().toISOString(),
    isExhausted: false,
  }
}
