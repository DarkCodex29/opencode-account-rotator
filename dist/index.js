// src/config.ts
import { readFile } from "fs/promises";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
import { z } from "zod";

// src/debug-log.ts
import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var DEBUG_LOG_PATH = join(
  homedir(),
  ".config",
  "opencode",
  "account-rotator-debug.log"
);
function debugLog(msg) {
  const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${msg}
`;
  try {
    appendFileSync(DEBUG_LOG_PATH, line, "utf-8");
  } catch {
  }
}

// src/config.ts
var DEFAULT_COOLDOWN_MS = 3e5;
var DEFAULT_MAX_HISTORY_SIZE = 50;
var DEFAULT_NOTIFY_ON_ROTATION = true;
var CONFIG_PATH = join2(homedir2(), ".config", "opencode", "account-rotator.json");
var accountEntrySchema = z.object({
  enabled: z.boolean()
});
var pluginConfigSchema = z.object({
  accountOrder: z.array(z.string()).optional(),
  cooldownMs: z.number().int().positive().optional(),
  maxHistorySize: z.number().int().positive().optional(),
  notifyOnRotation: z.boolean().optional(),
  accounts: z.record(z.string(), accountEntrySchema).optional()
});
async function loadConfig() {
  let raw = void 0;
  try {
    const content = await readFile(CONFIG_PATH, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return buildDefaults({});
    }
    debugLog(
      `[account-rotator] Failed to read config at ${CONFIG_PATH}: ${String(err)}`
    );
    return buildDefaults({});
  }
  const result = pluginConfigSchema.safeParse(raw);
  if (!result.success) {
    debugLog(
      `[account-rotator] Config at ${CONFIG_PATH} failed validation \u2014 using defaults.
` + result.error.toString()
    );
    return buildDefaults({});
  }
  const d = result.data;
  return buildDefaults({
    ...d.accountOrder !== void 0 && { accountOrder: d.accountOrder },
    ...d.cooldownMs !== void 0 && { cooldownMs: d.cooldownMs },
    ...d.maxHistorySize !== void 0 && { maxHistorySize: d.maxHistorySize },
    ...d.notifyOnRotation !== void 0 && { notifyOnRotation: d.notifyOnRotation },
    ...d.accounts !== void 0 && { accounts: d.accounts }
  });
}
function buildDefaults(partial) {
  return {
    accountOrder: partial.accountOrder !== void 0 ? partial.accountOrder : [],
    cooldownMs: partial.cooldownMs !== void 0 ? partial.cooldownMs : DEFAULT_COOLDOWN_MS,
    maxHistorySize: partial.maxHistorySize !== void 0 ? partial.maxHistorySize : DEFAULT_MAX_HISTORY_SIZE,
    notifyOnRotation: partial.notifyOnRotation !== void 0 ? partial.notifyOnRotation : DEFAULT_NOTIFY_ON_ROTATION,
    accounts: partial.accounts !== void 0 ? partial.accounts : {}
  };
}
function isNodeError(err) {
  return err instanceof Error && "code" in err;
}

// src/credential-store.ts
import { readdir, readFile as readFile2 } from "fs/promises";
import { homedir as homedir3 } from "os";
import { join as join3 } from "path";
import { z as z2 } from "zod";
var CCS_INSTANCES_DIR = join3(homedir3(), ".ccs", "instances");
var CREDENTIALS_FILENAME = ".credentials.json";
var AUTH_JSON_PATH = join3(homedir3(), ".local", "share", "opencode", "auth.json");
var CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
var OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
var TOKEN_REFRESH_TIMEOUT_MS = 3e3;
var credentialsSchema = z2.object({
  claudeAiOauth: z2.object({
    accessToken: z2.string().min(1),
    refreshToken: z2.string().min(1),
    expiresAt: z2.number().int()
  })
});
async function discover() {
  let entries;
  try {
    entries = await readdir(CCS_INSTANCES_DIR);
  } catch (err) {
    if (isNodeError2(err) && err.code === "ENOENT") {
      return [];
    }
    debugLog(`[account-rotator] Failed to read ${CCS_INSTANCES_DIR}: ${String(err)}`);
    return [];
  }
  entries.sort();
  const accounts = [];
  for (const entry of entries) {
    const credPath = join3(CCS_INSTANCES_DIR, entry, CREDENTIALS_FILENAME);
    let raw;
    try {
      const content = await readFile2(credPath, "utf-8");
      raw = JSON.parse(content);
    } catch (err) {
      debugLog(
        `[account-rotator] Skipping instance "${entry}": cannot read ${credPath} \u2014 ${String(err)}`
      );
      continue;
    }
    const result = credentialsSchema.safeParse(raw);
    if (!result.success) {
      debugLog(
        `[account-rotator] Skipping instance "${entry}": invalid credentials schema at ${credPath}
` + result.error.toString()
      );
      continue;
    }
    const { claudeAiOauth } = result.data;
    accounts.push({
      name: entry,
      credentialsPath: credPath,
      accessToken: claudeAiOauth.accessToken,
      refreshToken: claudeAiOauth.refreshToken,
      expiresAt: claudeAiOauth.expiresAt
    });
  }
  return accounts;
}
function applyConfigOrder(accounts, config) {
  const filtered = accounts.filter((acc) => {
    const entry = config.accounts[acc.name];
    return entry === void 0 || entry.enabled;
  });
  if (config.accountOrder.length === 0) {
    return filtered;
  }
  const byName = new Map(filtered.map((a) => [a.name, a]));
  const ordered = [];
  const used = /* @__PURE__ */ new Set();
  for (const name of config.accountOrder) {
    const acc = byName.get(name);
    if (acc !== void 0) {
      ordered.push(acc);
      used.add(name);
    }
  }
  for (const acc of filtered) {
    if (!used.has(acc.name)) {
      ordered.push(acc);
    }
  }
  return ordered;
}
async function refreshAccountToken(account) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_REFRESH_TIMEOUT_MS);
  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      debugLog(
        `[account-rotator] Token refresh failed for "${account.name}": HTTP ${response.status}`
      );
      return account;
    }
    const data = await response.json();
    const now = Date.now();
    const expiresAt = data.expires_in != null ? now + data.expires_in * 1e3 : account.expiresAt;
    const updated = {
      ...account,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? account.refreshToken,
      expiresAt
    };
    return updated;
  } catch (err) {
    if (isAbortError(err)) {
      debugLog(
        `[account-rotator] Token refresh timed out for "${account.name}" \u2014 using existing token`
      );
    } else {
      debugLog(
        `[account-rotator] Token refresh error for "${account.name}": ${String(err)}`
      );
    }
    return account;
  } finally {
    clearTimeout(timer);
  }
}
async function readAuthJson() {
  try {
    const content = await readFile2(AUTH_JSON_PATH, "utf-8");
    const raw = JSON.parse(content);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const obj = raw;
    const anthropic = obj["anthropic"];
    if (anthropic === null || typeof anthropic !== "object" || Array.isArray(anthropic)) {
      return null;
    }
    const a = anthropic;
    if (typeof a["access"] !== "string" || typeof a["refresh"] !== "string" || typeof a["expires"] !== "number") {
      return null;
    }
    return {
      access: a["access"],
      refresh: a["refresh"],
      expires: a["expires"]
    };
  } catch (err) {
    if (isNodeError2(err) && err.code === "ENOENT") {
      return null;
    }
    debugLog(
      `[account-rotator] Failed to read auth.json at ${AUTH_JSON_PATH}: ${String(err)}`
    );
    return null;
  }
}
async function rediscoverAccount(name) {
  const credPath = join3(CCS_INSTANCES_DIR, name, CREDENTIALS_FILENAME);
  let raw;
  try {
    const content = await readFile2(credPath, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    debugLog(
      `[account-rotator] rediscoverAccount("${name}"): cannot read ${credPath} \u2014 ${String(err)}`
    );
    return null;
  }
  const result = credentialsSchema.safeParse(raw);
  if (!result.success) {
    debugLog(
      `[account-rotator] rediscoverAccount("${name}"): invalid schema at ${credPath}
` + result.error.toString()
    );
    return null;
  }
  const { claudeAiOauth } = result.data;
  return {
    name,
    credentialsPath: credPath,
    accessToken: claudeAiOauth.accessToken,
    refreshToken: claudeAiOauth.refreshToken,
    expiresAt: claudeAiOauth.expiresAt
  };
}
function isNodeError2(err) {
  return err instanceof Error && "code" in err;
}
function isAbortError(err) {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}
function isTokenExpired(account, bufferMs = 6e4) {
  return account.expiresAt - Date.now() < bufferMs;
}

// src/rotation-engine.ts
var RotationEngine = class {
  accounts = [];
  config;
  state;
  _status = "idle";
  // Mutex: true when a rotation is in progress
  locked = false;
  // Single pending slot for queued concurrent rotation requests (SC-019)
  pendingRotation = null;
  constructor(config, initialState) {
    this.config = config;
    this.state = initialState;
  }
  // ---------------------------------------------------------------------------
  // Public: account list management
  // ---------------------------------------------------------------------------
  /**
   * Updates the account list (called after CCS discovery + config ordering).
   * Resets rotationIndex if it exceeds the new account count.
   */
  setAccounts(accounts) {
    this.accounts = accounts;
    this.state.accounts = accounts.map((a) => a.name);
    if (this.state.rotationIndex >= accounts.length) {
      this.state.rotationIndex = 0;
    }
  }
  /** Current account list */
  getAccounts() {
    return this.accounts;
  }
  // ---------------------------------------------------------------------------
  // Public: status
  // ---------------------------------------------------------------------------
  get status() {
    return this._status;
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
  async rotate(fromAccount, trigger, retryAfterMs) {
    if (this.locked) {
      return new Promise((resolve) => {
        this.pendingRotation = () => {
          void this.rotate(fromAccount, trigger, retryAfterMs).then(resolve);
        };
      });
    }
    this.locked = true;
    this._status = "rotating";
    try {
      if (fromAccount !== null) {
        this.markCooldown(fromAccount, retryAfterMs ?? this.config.cooldownMs, "429");
      }
      const next = this.nextAvailableAccount();
      if (next === null) {
        this._status = "exhausted";
        return null;
      }
      this.addHistoryEntry({
        timestamp: Date.now(),
        from: fromAccount,
        to: next.name,
        trigger
      });
      this.state.activeAccount = next.name;
      this.state.lastRotation = Date.now();
      this._status = "idle";
      return next;
    } finally {
      this.locked = false;
      if (this.pendingRotation !== null) {
        const pending = this.pendingRotation;
        this.pendingRotation = null;
        pending();
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
  markCooldown(accountName, durationMs, reason) {
    const until = Date.now() + durationMs;
    this.state.cooldowns = this.state.cooldowns.filter(
      (c) => c.account !== accountName
    );
    this.state.cooldowns.push({ account: accountName, until, reason });
    this._status = "cooldown";
  }
  /**
   * Removes expired cooldowns from state.
   * Should be called before any account selection.
   */
  pruneExpiredCooldowns() {
    const now = Date.now();
    this.state.cooldowns = this.state.cooldowns.filter((c) => c.until > now);
  }
  // ---------------------------------------------------------------------------
  // Public: exhaustion detection (SC-008, SC-011)
  // ---------------------------------------------------------------------------
  /**
   * Returns true when ALL accounts have an active cooldown window.
   */
  isExhausted() {
    this.pruneExpiredCooldowns();
    if (this.accounts.length === 0) return false;
    const cooldownNames = new Set(this.state.cooldowns.map((c) => c.account));
    return this.accounts.every((a) => cooldownNames.has(a.name));
  }
  /**
   * Returns the shortest remaining cooldown in milliseconds across all exhausted accounts.
   * Returns 0 if not exhausted.
   */
  shortestCooldownMs() {
    if (!this.isExhausted()) return 0;
    const now = Date.now();
    const remaining = this.state.cooldowns.map((c) => Math.max(0, c.until - now));
    return remaining.length > 0 ? Math.min(...remaining) : 0;
  }
  /**
   * Schedules automatic cooldown expiry and re-enable.
   * Calls `onReady()` when the shortest cooldown expires.
   */
  scheduleReEnable(onReady) {
    const ms = this.shortestCooldownMs();
    if (ms <= 0) {
      onReady();
      return;
    }
    setTimeout(() => {
      this.pruneExpiredCooldowns();
      this._status = "idle";
      onReady();
    }, ms);
  }
  // ---------------------------------------------------------------------------
  // Public: in-memory history (REQ-010)
  // ---------------------------------------------------------------------------
  /** Returns a copy of the rotation history (most recent last) */
  getHistory() {
    return [...this.state.history];
  }
  // ---------------------------------------------------------------------------
  // Public: state snapshot (for persistence layer)
  // ---------------------------------------------------------------------------
  getState() {
    return { ...this.state, cooldowns: [...this.state.cooldowns] };
  }
  /**
   * Merges persisted state (loaded from disk) back into the engine.
   * Called on startup after loading the state file.
   */
  restoreState(persisted) {
    if (persisted.activeAccount !== void 0) {
      this.state.activeAccount = persisted.activeAccount;
    }
    if (persisted.rotationIndex !== void 0) {
      this.state.rotationIndex = persisted.rotationIndex;
    }
    if (persisted.cooldowns !== void 0) {
      this.state.cooldowns = persisted.cooldowns;
    }
    if (persisted.lastRotation !== void 0) {
      this.state.lastRotation = persisted.lastRotation;
    }
    this.pruneExpiredCooldowns();
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
  nextAvailableAccount() {
    this.pruneExpiredCooldowns();
    const n = this.accounts.length;
    if (n === 0) return null;
    const cooldownNames = new Set(this.state.cooldowns.map((c) => c.account));
    for (let i = 1; i <= n; i++) {
      const candidateIndex = (this.state.rotationIndex + i) % n;
      const candidate = this.accounts[candidateIndex];
      if (candidate !== void 0 && !cooldownNames.has(candidate.name)) {
        this.state.rotationIndex = candidateIndex;
        return candidate;
      }
    }
    return null;
  }
  /**
   * Adds an event to the history ring-buffer, capping at maxHistorySize.
   */
  addHistoryEntry(event) {
    this.state.history.push(event);
    const max = this.config.maxHistorySize;
    if (this.state.history.length > max) {
      this.state.history.splice(0, this.state.history.length - max);
    }
  }
};
function parseRetryAfter(headerValue) {
  if (headerValue == null || headerValue.trim() === "") return void 0;
  const asNumber = Number(headerValue.trim());
  if (!Number.isNaN(asNumber) && asNumber >= 0) {
    return Math.round(asNumber * 1e3);
  }
  const asDate = new Date(headerValue).getTime();
  if (!Number.isNaN(asDate)) {
    const remaining = asDate - Date.now();
    return remaining > 0 ? remaining : 0;
  }
  return void 0;
}
function createEmptyState() {
  return {
    activeAccount: null,
    accounts: [],
    rotationIndex: 0,
    cooldowns: [],
    lastRotation: null,
    history: []
  };
}

// src/state.ts
import { readFile as readFile3, writeFile, rename, mkdir } from "fs/promises";
import { homedir as homedir4 } from "os";
import { join as join4, dirname } from "path";
import { z as z3 } from "zod";
var STATE_PATH = join4(
  homedir4(),
  ".config",
  "opencode",
  "account-rotator-state.json"
);
var cooldownEntrySchema = z3.object({
  account: z3.string(),
  until: z3.number().int().nonnegative(),
  reason: z3.enum(["429", "401", "refresh-failed"])
});
var healthStatusSchema = z3.enum(["ready", "exhausted", "unknown", "unchecked"]);
var persistedStateSchema = z3.object({
  activeAccount: z3.string().nullable(),
  accounts: z3.array(z3.string()),
  rotationIndex: z3.number().int().nonnegative(),
  cooldowns: z3.array(cooldownEntrySchema),
  lastRotation: z3.number().int().nullable(),
  healthStatuses: z3.record(z3.string(), healthStatusSchema).optional()
});
function defaultState() {
  return {
    activeAccount: null,
    accounts: [],
    rotationIndex: 0,
    cooldowns: [],
    lastRotation: null
  };
}
async function loadState() {
  let raw;
  try {
    const content = await readFile3(STATE_PATH, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    if (isNodeError3(err) && err.code === "ENOENT") {
      return defaultState();
    }
    debugLog(
      `[account-rotator] Failed to read state at ${STATE_PATH}: ${String(err)} \u2014 starting fresh`
    );
    return defaultState();
  }
  const result = persistedStateSchema.safeParse(raw);
  if (!result.success) {
    debugLog(
      `[account-rotator] State file at ${STATE_PATH} has invalid schema \u2014 starting fresh.
` + result.error.toString()
    );
    return defaultState();
  }
  const parsed = result.data;
  const state = {
    activeAccount: parsed.activeAccount,
    accounts: parsed.accounts,
    rotationIndex: parsed.rotationIndex,
    cooldowns: parsed.cooldowns,
    lastRotation: parsed.lastRotation
  };
  if (parsed.healthStatuses !== void 0) {
    state.healthStatuses = parsed.healthStatuses;
  }
  return state;
}
var saveChain = Promise.resolve();
function saveState(state) {
  const snapshot = {
    activeAccount: state.activeAccount,
    accounts: [...state.accounts],
    rotationIndex: state.rotationIndex,
    cooldowns: state.cooldowns.map((c) => ({ ...c })),
    lastRotation: state.lastRotation
  };
  saveChain = saveChain.then(() => doSaveState(snapshot)).catch(() => {
  });
  return saveChain;
}
async function doSaveState(state) {
  const payload = {
    activeAccount: state.activeAccount,
    accounts: state.accounts,
    rotationIndex: state.rotationIndex,
    cooldowns: state.cooldowns,
    lastRotation: state.lastRotation
  };
  const tmpPath = STATE_PATH + ".tmp";
  try {
    await mkdir(dirname(STATE_PATH), { recursive: true });
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
    await rename(tmpPath, STATE_PATH);
  } catch (err) {
    debugLog(
      `[account-rotator] Failed to save state to ${STATE_PATH}: ${String(err)}`
    );
  }
}
function isNodeError3(err) {
  return err instanceof Error && "code" in err;
}

// src/auth-watcher.ts
import { watch } from "fs";
function matchTokenToAccount(accessToken, accounts) {
  const match = accounts.find((a) => a.accessToken === accessToken);
  return match?.name ?? null;
}
function createAuthWatcher(opts) {
  const { accounts, onAccountChanged } = opts;
  let currentAccount = null;
  let debounceTimer = null;
  let watcher = null;
  const handleChange = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void processAuthChange();
    }, 500);
  };
  const processAuthChange = async () => {
    const authData = await readAuthJson();
    if (authData === null) {
      debugLog(
        "[account-rotator] auth.json is absent or unreadable \u2014 preserving last known active account"
      );
      return;
    }
    const matched = matchTokenToAccount(authData.access, accounts);
    if (matched !== currentAccount) {
      currentAccount = matched;
      try {
        await onAccountChanged(matched);
      } catch (err) {
        debugLog(
          `[account-rotator] auth-watcher callback error: ${String(err)}`
        );
      }
    }
  };
  try {
    watcher = watch(AUTH_JSON_PATH, { persistent: false }, (eventType) => {
      if (eventType === "change" || eventType === "rename") {
        handleChange();
      }
    });
    watcher.on("error", (err) => {
      const nodeErr = err;
      if (nodeErr.code === "ENOENT") {
        debugLog("[account-rotator] auth.json watcher: file not found \u2014 watching parent dir");
      } else {
        debugLog(`[account-rotator] auth.json watcher error: ${String(err)}`);
      }
    });
  } catch (err) {
    const nodeErr = err;
    if (nodeErr.code === "ENOENT") {
      debugLog(
        `[account-rotator] auth.json not found at ${AUTH_JSON_PATH} \u2014 watcher inactive until file is created`
      );
    } else {
      debugLog(`[account-rotator] Failed to start auth watcher: ${String(err)}`);
    }
  }
  return {
    getCurrentAccount() {
      return currentAccount;
    },
    close() {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      watcher?.close();
      watcher = null;
    }
  };
}

// src/index.ts
var plugin = async (input) => {
  const { client } = input;
  const config = await loadConfig();
  let accounts = await discover();
  accounts = applyConfigOrder(accounts, config);
  const persisted = await loadState();
  const initialState = {
    ...persisted,
    history: []
    // in-memory only — starts empty every session (SC-018)
  };
  const engine = new RotationEngine(config, initialState);
  engine.setAccounts(accounts);
  engine.restoreState(persisted);
  if (accounts.length === 0) {
    notify(
      "Account Rotator: no CCS instances found",
      config.notifyOnRotation
    );
    return {
      event: async () => {
      }
    };
  }
  const authData = await readAuthJson();
  if (authData !== null) {
    const matchedName = matchTokenToAccount(authData.access, accounts);
    if (matchedName !== null) {
      engine.restoreState({ activeAccount: matchedName });
      notify(
        `[account-rotator] Startup auth sync: active account set to "${matchedName}"`,
        config.notifyOnRotation
      );
    } else {
      debugLog(
        "[account-rotator] Startup auth sync: auth.json token does not match any known CCS account"
      );
    }
  }
  await saveState(engine.getState());
  const authWatcher = createAuthWatcher({
    accounts,
    onAccountChanged: async (accountName) => {
      const previousAccount = engine.getState().activeAccount;
      if (accountName !== null) {
        if (accountName !== previousAccount) {
          engine.restoreState({ activeAccount: accountName });
          await saveState(engine.getState());
          notify(
            `[account-rotator] Auth watcher: active account changed to "${accountName}"`,
            config.notifyOnRotation
          );
        }
        return;
      }
      debugLog(
        `[account-rotator] Auth watcher: token did not match any known account \u2014 attempting re-discovery`
      );
      const authData2 = await readAuthJson();
      if (authData2 !== null) {
        for (const acc of accounts) {
          const fresh = await rediscoverAccount(acc.name);
          if (fresh !== null && fresh.accessToken === authData2.access) {
            acc.accessToken = fresh.accessToken;
            acc.refreshToken = fresh.refreshToken;
            acc.expiresAt = fresh.expiresAt;
            if (fresh.name !== previousAccount) {
              engine.restoreState({ activeAccount: fresh.name });
              await saveState(engine.getState());
              notify(
                `[account-rotator] Auth watcher: re-discovered token matches "${fresh.name}" \u2014 updating active account`,
                config.notifyOnRotation
              );
            } else {
              debugLog(
                `[account-rotator] Auth watcher: re-discovered token still matches "${fresh.name}" (token was refreshed in-place)`
              );
            }
            return;
          }
        }
      }
      debugLog(
        `[account-rotator] Auth watcher: active account changed to "null" \u2014 initiating active rotation`
      );
      if (previousAccount !== null) {
        engine.markCooldown(previousAccount, config.cooldownMs, "429");
      }
      if (engine.isExhausted()) {
        const waitSec = Math.ceil(engine.shortestCooldownMs() / 1e3);
        notify(
          `[account-rotator] Auth watcher: all accounts exhausted \u2014 retry in ${waitSec}s`,
          config.notifyOnRotation
        );
        engine.scheduleReEnable(() => {
          notify(
            "\u{1F504} Account Rotator: cooldown expired \u2014 accounts available again",
            config.notifyOnRotation
          );
        });
        await saveState(engine.getState());
        return;
      }
      try {
        const next = await engine.rotate(null, "429");
        if (next === null) {
          const waitSec = Math.ceil(engine.shortestCooldownMs() / 1e3);
          notify(
            `[account-rotator] Auth watcher: all accounts exhausted after rotation \u2014 retry in ${waitSec}s`,
            config.notifyOnRotation
          );
          engine.scheduleReEnable(() => {
            notify(
              "\u{1F504} Account Rotator: cooldown expired \u2014 accounts available again",
              config.notifyOnRotation
            );
          });
          await saveState(engine.getState());
          return;
        }
        let accountToActivate = next;
        if (isTokenExpired(next)) {
          accountToActivate = await refreshAccountToken(next);
        }
        await client.auth.set({
          path: { id: "anthropic" },
          body: {
            type: "oauth",
            access: accountToActivate.accessToken,
            refresh: accountToActivate.refreshToken,
            expires: accountToActivate.expiresAt
          }
        });
        await saveState(engine.getState());
        const allAccounts = engine.getAccounts();
        const idx = allAccounts.findIndex((a) => a.name === accountToActivate.name) + 1;
        notify(
          `\u{1F504} [account-rotator] Auth watcher: rotated to ${accountToActivate.name} (${idx}/${allAccounts.length})`,
          config.notifyOnRotation
        );
      } catch (err) {
        debugLog(
          `[account-rotator] Auth watcher: active rotation failed \u2014 ${String(err)}`
        );
      }
    }
  });
  notify(
    `\u2705 Account Rotator: loaded ${accounts.length} account(s) \u2014 ${accounts.map((a) => a.name).join(", ")}`,
    config.notifyOnRotation
  );
  return {
    dispose: () => {
      authWatcher.close();
    },
    event: async ({ event }) => {
      if (event.type !== "session.error") return;
      const err = event.properties?.error;
      if (err == null) return;
      if (err.statusCode !== 429) return;
      const fromAccount = engine.getState().activeAccount;
      const retryAfterHeader = err.headers?.["retry-after"] ?? err.headers?.["Retry-After"];
      const retryAfterMs = parseRetryAfter(retryAfterHeader);
      if (engine.isExhausted()) {
        const waitSec = Math.ceil(engine.shortestCooldownMs() / 1e3);
        notifyToast(
          `\u26D4 All accounts exhausted. Retry in ${waitSec}s`,
          config.notifyOnRotation
        );
        engine.scheduleReEnable(() => {
          notify(
            "\u{1F504} Account Rotator: cooldown expired \u2014 accounts available again",
            config.notifyOnRotation
          );
        });
        return;
      }
      const next = await engine.rotate(fromAccount, "429", retryAfterMs);
      if (next === null) {
        const waitSec = Math.ceil(engine.shortestCooldownMs() / 1e3);
        notifyToast(
          `\u26D4 All accounts exhausted. Retry in ${waitSec}s`,
          config.notifyOnRotation
        );
        engine.scheduleReEnable(() => {
          notify(
            "\u{1F504} Account Rotator: cooldown expired \u2014 accounts available again",
            config.notifyOnRotation
          );
        });
        return;
      }
      let accountToUse = next;
      if (isTokenExpired(next)) {
        accountToUse = await refreshAccountToken(next);
      }
      await client.auth.set({
        path: { id: "anthropic" },
        body: {
          type: "oauth",
          access: accountToUse.accessToken,
          refresh: accountToUse.refreshToken,
          expires: accountToUse.expiresAt
        }
      });
      await saveState(engine.getState());
      const allAccounts = engine.getAccounts();
      const idx = allAccounts.findIndex((a) => a.name === accountToUse.name) + 1;
      notifyToast(
        `\u{1F504} Rate limit hit \u2014 switched to ${accountToUse.name} (${idx}/${allAccounts.length})`,
        config.notifyOnRotation
      );
    }
  };
};
function notifyToast(message, enabled) {
  if (!enabled) return;
  debugLog(`[account-rotator toast] ${message}`);
}
function notify(message, enabled) {
  if (!enabled) return;
  debugLog(`[account-rotator] ${message}`);
}
var index_default = {
  id: "account-rotator",
  server: plugin
};
export {
  RotationEngine,
  applyConfigOrder,
  createEmptyState,
  index_default as default,
  discover,
  loadConfig,
  loadState,
  parseRetryAfter,
  plugin,
  saveState
};
//# sourceMappingURL=index.js.map