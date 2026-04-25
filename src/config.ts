/**
 * Config loader for opencode-account-rotator.
 *
 * Reads ~/.config/opencode/account-rotator.json and validates it with zod.
 * Falls back to safe defaults when the file is absent or invalid (SC-010).
 */

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import type { PluginConfig, ResolvedConfig } from "./types.js"

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_COOLDOWN_MS = 300_000 // 5 minutes
const DEFAULT_MAX_HISTORY_SIZE = 50
const DEFAULT_NOTIFY_ON_ROTATION = true

const CONFIG_PATH = join(homedir(), ".config", "opencode", "account-rotator.json")

// ---------------------------------------------------------------------------
// Zod schema for the raw config file
// ---------------------------------------------------------------------------

const accountEntrySchema = z.object({
  enabled: z.boolean(),
})

const pluginConfigSchema = z.object({
  accountOrder: z.array(z.string()).optional(),
  cooldownMs: z.number().int().positive().optional(),
  maxHistorySize: z.number().int().positive().optional(),
  notifyOnRotation: z.boolean().optional(),
  accounts: z.record(z.string(), accountEntrySchema).optional(),
})

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads and validates the plugin configuration from disk.
 *
 * If the file is absent, returns default config without error (SC-010).
 * If the file exists but fails validation, logs a warning and returns defaults.
 */
export async function loadConfig(): Promise<ResolvedConfig> {
  let raw: unknown = undefined

  try {
    const content = await readFile(CONFIG_PATH, "utf-8")
    raw = JSON.parse(content) as unknown
  } catch (err) {
    // File doesn't exist → fall back to defaults (SC-010)
    if (isNodeError(err) && err.code === "ENOENT") {
      return buildDefaults({})
    }
    // Unexpected read/parse error → warn and use defaults
    console.warn(
      `[account-rotator] Failed to read config at ${CONFIG_PATH}: ${String(err)}`
    )
    return buildDefaults({})
  }

  const result = pluginConfigSchema.safeParse(raw)
  if (!result.success) {
    console.warn(
      `[account-rotator] Config at ${CONFIG_PATH} failed validation — using defaults.\n` +
        result.error.toString()
    )
    return buildDefaults({})
  }

  const d = result.data
  return buildDefaults({
    ...(d.accountOrder !== undefined && { accountOrder: d.accountOrder }),
    ...(d.cooldownMs !== undefined && { cooldownMs: d.cooldownMs }),
    ...(d.maxHistorySize !== undefined && { maxHistorySize: d.maxHistorySize }),
    ...(d.notifyOnRotation !== undefined && { notifyOnRotation: d.notifyOnRotation }),
    ...(d.accounts !== undefined && { accounts: d.accounts }),
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDefaults(partial: {
  accountOrder?: string[]
  cooldownMs?: number
  maxHistorySize?: number
  notifyOnRotation?: boolean
  accounts?: Record<string, { enabled: boolean }>
}): ResolvedConfig {
  return {
    accountOrder: partial.accountOrder !== undefined ? partial.accountOrder : [],
    cooldownMs: partial.cooldownMs !== undefined ? partial.cooldownMs : DEFAULT_COOLDOWN_MS,
    maxHistorySize: partial.maxHistorySize !== undefined ? partial.maxHistorySize : DEFAULT_MAX_HISTORY_SIZE,
    notifyOnRotation: partial.notifyOnRotation !== undefined ? partial.notifyOnRotation : DEFAULT_NOTIFY_ON_ROTATION,
    accounts: partial.accounts !== undefined ? partial.accounts : {},
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err
}

/**
 * Returns the resolved config path (useful for logging).
 */
export function getConfigPath(): string {
  return CONFIG_PATH
}
