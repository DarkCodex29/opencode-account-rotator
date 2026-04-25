/**
 * Core domain types for the opencode-account-rotator plugin.
 * These types mirror the design contracts from the SDD design document.
 */
/**
 * A discovered CCS account instance with its OAuth credentials.
 * One instance corresponds to one ~/.ccs/instances/{name}/ directory.
 */
interface Account {
    /** CCS instance name (directory basename under ~/.ccs/instances/) */
    name: string;
    /** Absolute path to the .credentials.json file */
    credentialsPath: string;
    /** OAuth access token (may be expired) */
    accessToken: string;
    /** OAuth refresh token (used to get a fresh access token) */
    refreshToken: string;
    /** Token expiry — Unix timestamp in milliseconds */
    expiresAt: number;
}
/** Reason an account entered cooldown */
type CooldownReason = "429" | "401" | "refresh-failed";
/**
 * A per-account cooldown window.
 * While `Date.now() < until`, this account must be skipped during rotation.
 */
interface CooldownEntry {
    /** Account name this cooldown applies to */
    account: string;
    /** Unix timestamp (ms) when the cooldown expires */
    until: number;
    /** Why the cooldown was imposed */
    reason: CooldownReason;
}
/** Trigger reasons for a rotation event */
type RotationTrigger = "429" | "manual" | "expiry";
/**
 * A single entry in the in-memory rotation history ring-buffer.
 * History is cleared on OpenCode restart (REQ-010, SC-018).
 */
interface RotationEvent {
    /** Unix timestamp (ms) when the rotation occurred */
    timestamp: number;
    /** Account that was active before rotation (null if this is the first selection) */
    from: string | null;
    /** Account activated after rotation */
    to: string;
    /** What triggered the rotation */
    trigger: RotationTrigger;
}
/**
 * The subset of rotation state that is persisted across restarts.
 * History is intentionally excluded (REQ-010).
 */
interface PersistedState {
    /** Name of the currently active account */
    activeAccount: string | null;
    /** Ordered account names defining the round-robin sequence */
    accounts: string[];
    /** Current position in the round-robin sequence */
    rotationIndex: number;
    /** Active cooldown windows */
    cooldowns: CooldownEntry[];
    /** Timestamp of the last rotation */
    lastRotation: number | null;
    /**
     * Health status per account name, as probed at startup.
     * @deprecated Passive health detection via auth watcher replaces startup probes.
     * Field kept for backward compat with existing state.json files. Do not write.
     */
    healthStatuses?: Record<string, HealthStatus>;
}
/**
 * Full in-memory rotation state — extends persisted state with transient history.
 */
interface RotationState extends PersistedState {
    /** In-memory rotation history (ring-buffer, not persisted) */
    history: RotationEvent[];
}
/**
 * User-supplied configuration from ~/.config/opencode/account-rotator.json.
 * All fields are optional; the plugin applies safe defaults when absent.
 */
interface PluginConfig {
    /** Preferred rotation order — array of CCS instance names */
    accountOrder?: string[];
    /** Default cooldown duration in ms when no Retry-After header is present */
    cooldownMs?: number;
    /** Maximum number of history entries kept in the ring-buffer */
    maxHistorySize?: number;
    /** Whether to emit TUI toast notifications on rotation */
    notifyOnRotation?: boolean;
    /** Per-account enabled/disabled flags — accounts set to false are excluded */
    accounts?: Record<string, {
        enabled: boolean;
    }>;
}
/**
 * Resolved plugin config with all defaults applied.
 * This is what the rest of the plugin works with.
 */
interface ResolvedConfig {
    accountOrder: string[];
    cooldownMs: number;
    maxHistorySize: number;
    notifyOnRotation: boolean;
    accounts: Record<string, {
        enabled: boolean;
    }>;
}
/**
 * States of the rotation engine state machine.
 *
 *   idle ──→ detecting ──→ rotating ──→ idle
 *                              │
 *                              └──→ cooldown ──→ idle
 *                              └──→ exhausted ──→ idle (after wait)
 */
type RotationStatus = "idle" | "detecting" | "rotating" | "cooldown" | "exhausted";
/**
 * Health status as reported by a startup probe against the Anthropic API.
 * Written to state.json by the runtime plugin; read by the TUI.
 */
type HealthStatus = "ready" | "exhausted" | "unknown" | "unchecked";

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

declare class RotationEngine {
    private accounts;
    private config;
    private state;
    private _status;
    private locked;
    private pendingRotation;
    constructor(config: ResolvedConfig, initialState: RotationState);
    /**
     * Updates the account list (called after CCS discovery + config ordering).
     * Resets rotationIndex if it exceeds the new account count.
     */
    setAccounts(accounts: Account[]): void;
    /** Current account list */
    getAccounts(): Account[];
    get status(): RotationStatus;
    /**
     * Initiates a round-robin rotation from the given account.
     *
     * - If a rotation is already in progress, queues this call (SC-019)
     * - Skips accounts in active cooldown
     * - Returns the next Account, or null if all accounts are exhausted
     */
    rotate(fromAccount: string | null, trigger: RotationTrigger, retryAfterMs?: number): Promise<Account | null>;
    /**
     * Marks an account as in cooldown for the given duration.
     * If a cooldown already exists for this account, it is replaced (refreshed).
     */
    markCooldown(accountName: string, durationMs: number, reason: CooldownReason): void;
    /**
     * Removes expired cooldowns from state.
     * Should be called before any account selection.
     */
    pruneExpiredCooldowns(): void;
    /**
     * Returns true when ALL accounts have an active cooldown window.
     */
    isExhausted(): boolean;
    /**
     * Returns the shortest remaining cooldown in milliseconds across all exhausted accounts.
     * Returns 0 if not exhausted.
     */
    shortestCooldownMs(): number;
    /**
     * Schedules automatic cooldown expiry and re-enable.
     * Calls `onReady()` when the shortest cooldown expires.
     */
    scheduleReEnable(onReady: () => void): void;
    /** Returns a copy of the rotation history (most recent last) */
    getHistory(): RotationEvent[];
    getState(): RotationState;
    /**
     * Merges persisted state (loaded from disk) back into the engine.
     * Called on startup after loading the state file.
     */
    restoreState(persisted: Partial<RotationState>): void;
    /**
     * Advances the rotationIndex and returns the next account not in cooldown.
     * Returns null if all accounts are in cooldown (exhausted).
     *
     * The index always advances — we never re-select the current account unless
     * it's the only one available and not in cooldown.
     */
    private nextAvailableAccount;
    /**
     * Adds an event to the history ring-buffer, capping at maxHistorySize.
     */
    private addHistoryEntry;
}
/**
 * Parses the Retry-After HTTP header value into milliseconds.
 *
 * Supports:
 * - Numeric string (seconds): "120" → 120_000ms
 * - HTTP date string: "Thu, 25 Apr 2026 12:00:00 GMT" → (date - now) ms
 * - Absent/unparseable → returns undefined (caller uses default)
 */
declare function parseRetryAfter(headerValue: string | null | undefined): number | undefined;
declare function createEmptyState(): RotationState;

/**
 * Config loader for opencode-account-rotator.
 *
 * Reads ~/.config/opencode/account-rotator.json and validates it with zod.
 * Falls back to safe defaults when the file is absent or invalid (SC-010).
 */

/**
 * Loads and validates the plugin configuration from disk.
 *
 * If the file is absent, returns default config without error (SC-010).
 * If the file exists but fails validation, logs a warning and returns defaults.
 */
declare function loadConfig(): Promise<ResolvedConfig>;

/**
 * CCS Credential Store for opencode-account-rotator.
 *
 * Discovers Claude Code Sessions (CCS) instances under ~/.ccs/instances/
 * Validates each instance's credential file against a known schema.
 * Applies the user-configured account order.
 * Handles OAuth token refresh with a 3-second timeout.
 */

/**
 * Discovers all valid CCS instances under ~/.ccs/instances/
 *
 * - Reads each subdirectory
 * - Validates the .credentials.json against the zod schema
 * - Skips and warns on invalid/missing files
 * - Returns accounts in alphabetical (filesystem) order before config reordering
 */
declare function discover(): Promise<Account[]>;
/**
 * Reorders discovered accounts according to the user's config.accountOrder.
 *
 * - Accounts listed in accountOrder come first (in that order)
 * - Accounts not in accountOrder follow in their discovery (alphabetical) order
 * - Accounts disabled in config.accounts are excluded entirely
 * - accountOrder entries not found in discovered accounts are silently ignored
 */
declare function applyConfigOrder(accounts: Account[], config: ResolvedConfig): Account[];

/**
 * State persistence for opencode-account-rotator.
 *
 * Persists the rotation index, active account, and cooldown windows across
 * OpenCode restarts. In-memory history is intentionally NOT persisted (REQ-010, SC-018).
 *
 * State file: ~/.config/opencode/account-rotator-state.json
 * Write strategy: atomic (write to .tmp, then rename) to avoid corruption.
 */

/**
 * Loads the persisted state from disk.
 *
 * Returns a default PersistedState if the file is absent or invalid.
 * Never throws — missing or corrupt state is treated as a fresh start.
 */
declare function loadState(): Promise<PersistedState>;
/**
 * Atomically saves the persisted state to disk.
 *
 * Uses write-to-tmp → rename to avoid partial writes (REQ-007 analogy).
 * Excludes the in-memory history ring-buffer (REQ-010, SC-018).
 *
 * Concurrent calls are serialized via an internal promise chain to prevent
 * ENOENT race conditions on the .tmp file rename step.
 */
declare function saveState(state: PersistedState): Promise<void>;

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
interface PluginInput {
    client: {
        auth: {
            set(opts: {
                path: {
                    id: string;
                };
                body: {
                    type: "oauth";
                    access: string;
                    refresh: string;
                    expires: number;
                };
            }): Promise<void>;
        };
    };
    directory: string;
}
interface SessionErrorEvent {
    type: "session.error";
    properties?: {
        error?: {
            statusCode?: number;
            message?: string;
            headers?: Record<string, string>;
        };
    };
}
type AnyEvent = SessionErrorEvent | {
    type: string;
};
type PluginHooks = {
    event?: (context: {
        event: AnyEvent;
    }) => void | Promise<void>;
    dispose?: () => void | Promise<void>;
};
type Plugin = (input: PluginInput) => PluginHooks | Promise<PluginHooks>;
declare const plugin: Plugin;
declare const _default: {
    id: string;
    server: Plugin;
};

export { type Account, type PluginConfig, type ResolvedConfig, RotationEngine, applyConfigOrder, createEmptyState, _default as default, discover, loadConfig, loadState, parseRetryAfter, plugin, saveState };
