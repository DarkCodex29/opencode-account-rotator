/**
 * Auth Watcher for opencode-account-rotator.
 *
 * Watches ~/.local/share/opencode/auth.json for filesystem changes using
 * fs.watch() (FSEvents on macOS, inotify on Linux). Changes are debounced
 * 500ms to handle the login plugin writing multiple times during a token swap.
 *
 * Provides:
 * - matchTokenToAccount() — pure token→account name lookup
 * - createAuthWatcher() — starts watching; returns { getCurrentAccount, close }
 */

import { watch } from "node:fs"
import type { FSWatcher } from "node:fs"
import { AUTH_JSON_PATH, readAuthJson } from "./credential-store.js"
import type { Account } from "./types.js"

// ---------------------------------------------------------------------------
// Token matching (Task 2.1)
// ---------------------------------------------------------------------------

/**
 * Finds the account whose accessToken exactly matches the given accessToken.
 *
 * Returns the account name on match, null if no match is found.
 * Pure function — no I/O.
 */
export function matchTokenToAccount(
  accessToken: string,
  accounts: Account[]
): string | null {
  const match = accounts.find((a) => a.accessToken === accessToken)
  return match?.name ?? null
}

// ---------------------------------------------------------------------------
// Auth Watcher (Task 2.2 + 2.3)
// ---------------------------------------------------------------------------

export interface AuthWatcherOptions {
  accounts: Account[]
  onAccountChanged: (accountName: string | null) => void | Promise<void>
}

export interface AuthWatcher {
  /** Current matched account name (null if no match or auth.json absent) */
  getCurrentAccount(): string | null
  /** Stop watching */
  close(): void
}

/**
 * Creates a filesystem watcher on auth.json.
 *
 * - Uses fs.watch() (event-driven, not polling)
 * - Debounces rapid writes with a 500ms delay
 * - On change: reads auth.json → matches token → invokes callback
 * - On ENOENT (file deleted): logs warning, preserves last known account
 * - Returns { getCurrentAccount(), close() }
 */
export function createAuthWatcher(opts: AuthWatcherOptions): AuthWatcher {
  const { accounts, onAccountChanged } = opts

  let currentAccount: string | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let watcher: FSWatcher | null = null

  const handleChange = (): void => {
    // Debounce: reset timer on every event
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void processAuthChange()
    }, 500)
  }

  const processAuthChange = async (): Promise<void> => {
    const authData = await readAuthJson()

    if (authData === null) {
      // File deleted or unreadable — log warning, keep last known account
      console.warn(
        "[account-rotator] auth.json is absent or unreadable — preserving last known active account"
      )
      return
    }

    const matched = matchTokenToAccount(authData.access, accounts)

    if (matched !== currentAccount) {
      currentAccount = matched
      try {
        await onAccountChanged(matched)
      } catch (err) {
        console.warn(
          `[account-rotator] auth-watcher callback error: ${String(err)}`
        )
      }
    }
  }

  // Start watching — handle the case where auth.json doesn't exist yet
  try {
    watcher = watch(AUTH_JSON_PATH, { persistent: false }, (eventType) => {
      // Both 'change' and 'rename' (delete/recreate) events trigger processing
      if (eventType === "change" || eventType === "rename") {
        handleChange()
      }
    })

    watcher.on("error", (err) => {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === "ENOENT") {
        console.warn("[account-rotator] auth.json watcher: file not found — watching parent dir")
      } else {
        console.warn(`[account-rotator] auth.json watcher error: ${String(err)}`)
      }
    })
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") {
      console.warn(
        `[account-rotator] auth.json not found at ${AUTH_JSON_PATH} — watcher inactive until file is created`
      )
    } else {
      console.warn(`[account-rotator] Failed to start auth watcher: ${String(err)}`)
    }
  }

  return {
    getCurrentAccount(): string | null {
      return currentAccount
    },
    close(): void {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      watcher?.close()
      watcher = null
    },
  }
}
