/**
 * State persistence for opencode-account-rotator.
 *
 * Persists the rotation index, active account, and cooldown windows across
 * OpenCode restarts. In-memory history is intentionally NOT persisted (REQ-010, SC-018).
 *
 * State file: ~/.config/opencode/account-rotator-state.json
 * Write strategy: atomic (write to .tmp, then rename) to avoid corruption.
 */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { z } from "zod"
import type { PersistedState, HealthStatus } from "./types.js"
import { debugLog } from "./debug-log.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STATE_PATH = join(
  homedir(),
  ".config",
  "opencode",
  "account-rotator-state.json"
)

// ---------------------------------------------------------------------------
// Zod schema for the persisted state
// ---------------------------------------------------------------------------

const cooldownEntrySchema = z.object({
  account: z.string(),
  until: z.number().int().nonnegative(),
  reason: z.enum(["429", "401", "refresh-failed"]),
})

const healthStatusSchema = z.enum(["ready", "exhausted", "unknown", "unchecked"])

const persistedStateSchema = z.object({
  activeAccount: z.string().nullable(),
  accounts: z.array(z.string()),
  rotationIndex: z.number().int().nonnegative(),
  cooldowns: z.array(cooldownEntrySchema),
  lastRotation: z.number().int().nullable(),
  healthStatuses: z.record(z.string(), healthStatusSchema).optional(),
})

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

function defaultState(): PersistedState {
  return {
    activeAccount: null,
    accounts: [],
    rotationIndex: 0,
    cooldowns: [],
    lastRotation: null,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads the persisted state from disk.
 *
 * Returns a default PersistedState if the file is absent or invalid.
 * Never throws — missing or corrupt state is treated as a fresh start.
 */
export async function loadState(): Promise<PersistedState> {
  let raw: unknown

  try {
    const content = await readFile(STATE_PATH, "utf-8")
    raw = JSON.parse(content) as unknown
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      // Fresh install — no state yet
      return defaultState()
    }
    debugLog(
      `[account-rotator] Failed to read state at ${STATE_PATH}: ${String(err)} — starting fresh`
    )
    return defaultState()
  }

  const result = persistedStateSchema.safeParse(raw)
  if (!result.success) {
    debugLog(
      `[account-rotator] State file at ${STATE_PATH} has invalid schema — starting fresh.\n` +
        result.error.toString()
    )
    return defaultState()
  }

  // Strip undefined optional fields to satisfy exactOptionalPropertyTypes
  const parsed = result.data
  const state: PersistedState = {
    activeAccount: parsed.activeAccount,
    accounts: parsed.accounts,
    rotationIndex: parsed.rotationIndex,
    cooldowns: parsed.cooldowns,
    lastRotation: parsed.lastRotation,
  }
  if (parsed.healthStatuses !== undefined) {
    state.healthStatuses = parsed.healthStatuses
  }
  return state
}

/**
 * Atomically saves the persisted state to disk.
 *
 * Uses write-to-tmp → rename to avoid partial writes (REQ-007 analogy).
 * Excludes the in-memory history ring-buffer (REQ-010, SC-018).
 */
export async function saveState(state: PersistedState): Promise<void> {
  const payload: Omit<PersistedState, "healthStatuses"> = {
    activeAccount: state.activeAccount,
    accounts: state.accounts,
    rotationIndex: state.rotationIndex,
    cooldowns: state.cooldowns,
    lastRotation: state.lastRotation,
  }

  const tmpPath = STATE_PATH + ".tmp"

  try {
    await mkdir(dirname(STATE_PATH), { recursive: true })
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8")
    await rename(tmpPath, STATE_PATH)
  } catch (err) {
    debugLog(
      `[account-rotator] Failed to save state to ${STATE_PATH}: ${String(err)}`
    )
  }
}

/**
 * Returns the resolved state file path (useful for logging / debugging).
 */
export function getStatePath(): string {
  return STATE_PATH
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err
}
