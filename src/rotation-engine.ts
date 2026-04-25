/**
 * Rotation Engine for opencode-account-rotator.
 *
 * Implements:
 * - Round-robin rotation strategy (REQ-009, SC-016)
 * - Per-account cooldown windows from Retry-After headers (REQ-006)
 * - All-accounts-exhausted detection (SC-008, SC-011)
 * - Mutex guard against concurrent rotations (REQ-011, SC-019)
 * - In-memory rotation history ring-buffer (REQ-010)
 */

import type {
  Account,
  CooldownEntry,
  CooldownReason,
  ResolvedConfig,
  RotationEvent,
  RotationState,
  RotationStatus,
  RotationTrigger,
} from "./types.js"

// ---------------------------------------------------------------------------
// Rotation Engine
// ---------------------------------------------------------------------------

export class RotationEngine {
  private accounts: Account[] = []
  private config: ResolvedConfig
  private state: RotationState
  private _status: RotationStatus = "idle"

  // Mutex: true when a rotation is in progress
  private locked = false
  // Single pending slot for queued concurrent rotation requests (SC-019)
  private pendingRotation: (() => void) | null = null

  constructor(config: ResolvedConfig, initialState: RotationState) {
    this.config = config
    this.state = initialState
  }

  // ---------------------------------------------------------------------------
  // Public: account list management
  // ---------------------------------------------------------------------------

  /**
   * Updates the account list (called after CCS discovery + config ordering).
   * Resets rotationIndex if it exceeds the new account count.
   */
  setAccounts(accounts: Account[]): void {
    this.accounts = accounts

    // Rebuild the ordered name list in state
    this.state.accounts = accounts.map((a) => a.name)

    // Clamp rotationIndex to valid range
    if (this.state.rotationIndex >= accounts.length) {
      this.state.rotationIndex = 0
    }
  }

  /** Current account list */
  getAccounts(): Account[] {
    return this.accounts
  }

  // ---------------------------------------------------------------------------
  // Public: status
  // ---------------------------------------------------------------------------

  get status(): RotationStatus {
    return this._status
  }

  // ---------------------------------------------------------------------------
  // Public: rotate (SC-016, REQ-009, REQ-011)
  // ---------------------------------------------------------------------------

  /**
   * Initiates a round-robin rotation from the given account.
   *
   * - If a rotation is already in progress, queues this call (SC-019)
   * - Skips accounts in active cooldown
   * - Returns the next Account, or null if all accounts are exhausted
   */
  async rotate(
    fromAccount: string | null,
    trigger: RotationTrigger,
    retryAfterMs?: number
  ): Promise<Account | null> {
    // --- Mutex guard (SC-019, REQ-011) ---
    if (this.locked) {
      return new Promise((resolve) => {
        // Replace any existing pending slot (single queue entry)
        this.pendingRotation = () => {
          void this.rotate(fromAccount, trigger, retryAfterMs).then(resolve)
        }
      })
    }

    this.locked = true
    this._status = "rotating"

    try {
      // Mark the triggering account with a cooldown (REQ-006)
      if (fromAccount !== null) {
        this.markCooldown(fromAccount, retryAfterMs ?? this.config.cooldownMs, "429")
      }

      // Advance to the next non-cooldown account
      const next = this.nextAvailableAccount()

      if (next === null) {
        this._status = "exhausted"
        return null
      }

      // Record in history
      this.addHistoryEntry({
        timestamp: Date.now(),
        from: fromAccount,
        to: next.name,
        trigger,
      })

      // Update persisted state
      this.state.activeAccount = next.name
      this.state.lastRotation = Date.now()
      this._status = "idle"

      return next
    } finally {
      this.locked = false

      // Drain the pending queue (single slot)
      if (this.pendingRotation !== null) {
        const pending = this.pendingRotation
        this.pendingRotation = null
        pending()
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public: cooldown management (REQ-006)
  // ---------------------------------------------------------------------------

  /**
   * Marks an account as in cooldown for the given duration.
   * If a cooldown already exists for this account, it is replaced (refreshed).
   */
  markCooldown(
    accountName: string,
    durationMs: number,
    reason: CooldownReason
  ): void {
    const until = Date.now() + durationMs

    // Remove any existing entry for this account
    this.state.cooldowns = this.state.cooldowns.filter(
      (c) => c.account !== accountName
    )

    this.state.cooldowns.push({ account: accountName, until, reason })
    this._status = "cooldown"
  }

  /**
   * Removes expired cooldowns from state.
   * Should be called before any account selection.
   */
  pruneExpiredCooldowns(): void {
    const now = Date.now()
    this.state.cooldowns = this.state.cooldowns.filter((c) => c.until > now)
  }

  // ---------------------------------------------------------------------------
  // Public: exhaustion detection (SC-008, SC-011)
  // ---------------------------------------------------------------------------

  /**
   * Returns true when ALL accounts have an active cooldown window.
   */
  isExhausted(): boolean {
    this.pruneExpiredCooldowns()
    if (this.accounts.length === 0) return false

    const cooldownNames = new Set(this.state.cooldowns.map((c) => c.account))
    return this.accounts.every((a) => cooldownNames.has(a.name))
  }

  /**
   * Returns the shortest remaining cooldown in milliseconds across all exhausted accounts.
   * Returns 0 if not exhausted.
   */
  shortestCooldownMs(): number {
    if (!this.isExhausted()) return 0
    const now = Date.now()
    const remaining = this.state.cooldowns.map((c) => Math.max(0, c.until - now))
    return remaining.length > 0 ? Math.min(...remaining) : 0
  }

  /**
   * Schedules automatic cooldown expiry and re-enable.
   * Calls `onReady()` when the shortest cooldown expires.
   */
  scheduleReEnable(onReady: () => void): void {
    const ms = this.shortestCooldownMs()
    if (ms <= 0) {
      onReady()
      return
    }
    setTimeout(() => {
      this.pruneExpiredCooldowns()
      this._status = "idle"
      onReady()
    }, ms)
  }

  // ---------------------------------------------------------------------------
  // Public: in-memory history (REQ-010)
  // ---------------------------------------------------------------------------

  /** Returns a copy of the rotation history (most recent last) */
  getHistory(): RotationEvent[] {
    return [...this.state.history]
  }

  // ---------------------------------------------------------------------------
  // Public: state snapshot (for persistence layer)
  // ---------------------------------------------------------------------------

  getState(): RotationState {
    return { ...this.state, cooldowns: [...this.state.cooldowns] }
  }

  /**
   * Merges persisted state (loaded from disk) back into the engine.
   * Called on startup after loading the state file.
   */
  restoreState(persisted: Partial<RotationState>): void {
    if (persisted.activeAccount !== undefined) {
      this.state.activeAccount = persisted.activeAccount
    }
    if (persisted.rotationIndex !== undefined) {
      this.state.rotationIndex = persisted.rotationIndex
    }
    if (persisted.cooldowns !== undefined) {
      this.state.cooldowns = persisted.cooldowns
    }
    if (persisted.lastRotation !== undefined) {
      this.state.lastRotation = persisted.lastRotation
    }
    // Prune expired cooldowns immediately on restore
    this.pruneExpiredCooldowns()
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Advances the rotationIndex and returns the next account not in cooldown.
   * Returns null if all accounts are in cooldown (exhausted).
   *
   * The index always advances — we never re-select the current account unless
   * it's the only one available and not in cooldown.
   */
  private nextAvailableAccount(): Account | null {
    this.pruneExpiredCooldowns()

    const n = this.accounts.length
    if (n === 0) return null

    const cooldownNames = new Set(this.state.cooldowns.map((c) => c.account))

    // Try each slot in round-robin order, starting AFTER current index
    for (let i = 1; i <= n; i++) {
      const candidateIndex = (this.state.rotationIndex + i) % n
      const candidate = this.accounts[candidateIndex]
      if (candidate !== undefined && !cooldownNames.has(candidate.name)) {
        this.state.rotationIndex = candidateIndex
        return candidate
      }
    }

    // All accounts are in cooldown
    return null
  }

  /**
   * Adds an event to the history ring-buffer, capping at maxHistorySize.
   */
  private addHistoryEntry(event: RotationEvent): void {
    this.state.history.push(event)
    const max = this.config.maxHistorySize
    if (this.state.history.length > max) {
      this.state.history.splice(0, this.state.history.length - max)
    }
  }
}

// ---------------------------------------------------------------------------
// Utility: parse Retry-After header value
// ---------------------------------------------------------------------------

/**
 * Parses the Retry-After HTTP header value into milliseconds.
 *
 * Supports:
 * - Numeric string (seconds): "120" → 120_000ms
 * - HTTP date string: "Thu, 25 Apr 2026 12:00:00 GMT" → (date - now) ms
 * - Absent/unparseable → returns undefined (caller uses default)
 */
export function parseRetryAfter(headerValue: string | null | undefined): number | undefined {
  if (headerValue == null || headerValue.trim() === "") return undefined

  const asNumber = Number(headerValue.trim())
  if (!Number.isNaN(asNumber) && asNumber >= 0) {
    return Math.round(asNumber * 1000)
  }

  // Try as HTTP date
  const asDate = new Date(headerValue).getTime()
  if (!Number.isNaN(asDate)) {
    const remaining = asDate - Date.now()
    return remaining > 0 ? remaining : 0
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Default empty rotation state factory
// ---------------------------------------------------------------------------

export function createEmptyState(): RotationState {
  return {
    activeAccount: null,
    accounts: [],
    rotationIndex: 0,
    cooldowns: [],
    lastRotation: null,
    history: [],
  }
}
