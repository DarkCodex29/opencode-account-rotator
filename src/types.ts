/**
 * Core domain types for the opencode-account-rotator plugin.
 * These types mirror the design contracts from the SDD design document.
 */

// ---------------------------------------------------------------------------
// Account credential types
// ---------------------------------------------------------------------------

/**
 * A discovered CCS account instance with its OAuth credentials.
 * One instance corresponds to one ~/.ccs/instances/{name}/ directory.
 */
export interface Account {
  /** CCS instance name (directory basename under ~/.ccs/instances/) */
  name: string
  /** Absolute path to the .credentials.json file */
  credentialsPath: string
  /** OAuth access token (may be expired) */
  accessToken: string
  /** OAuth refresh token (used to get a fresh access token) */
  refreshToken: string
  /** Token expiry — Unix timestamp in milliseconds */
  expiresAt: number
}

// ---------------------------------------------------------------------------
// Cooldown tracking
// ---------------------------------------------------------------------------

/** Reason an account entered cooldown */
export type CooldownReason = "429" | "401" | "refresh-failed"

/**
 * A per-account cooldown window.
 * While `Date.now() < until`, this account must be skipped during rotation.
 */
export interface CooldownEntry {
  /** Account name this cooldown applies to */
  account: string
  /** Unix timestamp (ms) when the cooldown expires */
  until: number
  /** Why the cooldown was imposed */
  reason: CooldownReason
}

// ---------------------------------------------------------------------------
// Rotation history (in-memory only, not persisted)
// ---------------------------------------------------------------------------

/** Trigger reasons for a rotation event */
export type RotationTrigger = "429" | "manual" | "expiry"

/**
 * A single entry in the in-memory rotation history ring-buffer.
 * History is cleared on OpenCode restart (REQ-010, SC-018).
 */
export interface RotationEvent {
  /** Unix timestamp (ms) when the rotation occurred */
  timestamp: number
  /** Account that was active before rotation (null if this is the first selection) */
  from: string | null
  /** Account activated after rotation */
  to: string
  /** What triggered the rotation */
  trigger: RotationTrigger
}

// ---------------------------------------------------------------------------
// Persisted state (written to account-rotator-state.json)
// ---------------------------------------------------------------------------

/**
 * The subset of rotation state that is persisted across restarts.
 * History is intentionally excluded (REQ-010).
 */
export interface PersistedState {
  /** Name of the currently active account */
  activeAccount: string | null
  /** Ordered account names defining the round-robin sequence */
  accounts: string[]
  /** Current position in the round-robin sequence */
  rotationIndex: number
  /** Active cooldown windows */
  cooldowns: CooldownEntry[]
  /** Timestamp of the last rotation */
  lastRotation: number | null
  /**
   * Health status per account name, as probed at startup.
   * @deprecated Passive health detection via auth watcher replaces startup probes.
   * Field kept for backward compat with existing state.json files. Do not write.
   */
  healthStatuses?: Record<string, HealthStatus>
}

/**
 * Full in-memory rotation state — extends persisted state with transient history.
 */
export interface RotationState extends PersistedState {
  /** In-memory rotation history (ring-buffer, not persisted) */
  history: RotationEvent[]
}

// ---------------------------------------------------------------------------
// Plugin configuration
// ---------------------------------------------------------------------------

/**
 * User-supplied configuration from ~/.config/opencode/account-rotator.json.
 * All fields are optional; the plugin applies safe defaults when absent.
 */
export interface PluginConfig {
  /** Preferred rotation order — array of CCS instance names */
  accountOrder?: string[]
  /** Default cooldown duration in ms when no Retry-After header is present */
  cooldownMs?: number
  /** Maximum number of history entries kept in the ring-buffer */
  maxHistorySize?: number
  /** Whether to emit TUI toast notifications on rotation */
  notifyOnRotation?: boolean
  /** Per-account enabled/disabled flags — accounts set to false are excluded */
  accounts?: Record<string, { enabled: boolean }>
}

/**
 * Resolved plugin config with all defaults applied.
 * This is what the rest of the plugin works with.
 */
export interface ResolvedConfig {
  accountOrder: string[]
  cooldownMs: number
  maxHistorySize: number
  notifyOnRotation: boolean
  accounts: Record<string, { enabled: boolean }>
}

// ---------------------------------------------------------------------------
// Rotation engine state machine
// ---------------------------------------------------------------------------

/**
 * States of the rotation engine state machine.
 *
 *   idle ──→ detecting ──→ rotating ──→ idle
 *                              │
 *                              └──→ cooldown ──→ idle
 *                              └──→ exhausted ──→ idle (after wait)
 */
export type RotationStatus =
  | "idle"
  | "detecting"
  | "rotating"
  | "cooldown"
  | "exhausted"

// ---------------------------------------------------------------------------
// Raw CCS credentials file schema (as read from disk)
// ---------------------------------------------------------------------------

/**
 * Shape of ~/.ccs/instances/{name}/.credentials.json
 */
export interface RawCCSCredentials {
  claudeAiOauth: {
    accessToken: string
    refreshToken: string
    expiresAt: number
  }
}

// ---------------------------------------------------------------------------
// OAuth token refresh response
// ---------------------------------------------------------------------------

export interface OAuthTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

// ---------------------------------------------------------------------------
// TUI display types
// ---------------------------------------------------------------------------

/**
 * Health status as reported by a startup probe against the Anthropic API.
 * Written to state.json by the runtime plugin; read by the TUI.
 */
export type HealthStatus = "ready" | "exhausted" | "unknown" | "unchecked"

/**
 * Display status for an account in the TUI sidebar and footer badge.
 * Derived from the persisted state + live cooldown calculation.
 */
export type AccountDisplayStatus =
  | "active"
  | "ready"
  | "cooldown"
  | "expired"
  | "disabled"
  | "exhausted"
  | "unknown"
