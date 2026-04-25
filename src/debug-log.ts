/**
 * Debug logger for opencode-account-rotator.
 *
 * Appends timestamped log lines to ~/.config/opencode/account-rotator-debug.log.
 * Uses synchronous appendFileSync so it never interleaves in async contexts.
 */

import { appendFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBUG_LOG_PATH = join(
  homedir(),
  ".config",
  "opencode",
  "account-rotator-debug.log"
)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Appends a single log line to the debug log file.
 *
 * Format: `{ISO-8601 UTC timestamp} {msg}\n`
 * Example: `2026-04-25T12:00:00.000Z test\n`
 *
 * Never throws — log failures are silently ignored so they can never
 * crash the plugin in production.
 */
export function debugLog(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}\n`
  try {
    appendFileSync(DEBUG_LOG_PATH, line, "utf-8")
  } catch {
    // Silently ignore — debug log must never crash the plugin
  }
}
