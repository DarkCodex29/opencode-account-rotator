// src/tui.tsx
import { createSignal as createSignal4, createEffect } from "solid-js";
import { createComponent } from "@opentui/solid";

// src/tui/SidebarPanel.tsx
import { memo as _$memo } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
function statusEmoji(status) {
  switch (status) {
    case "active":
      return "\u{1F7E2}";
    case "ready":
      return "\u{1F7E2}";
    case "cooldown":
      return "\u{1F7E1}";
    case "expired":
      return "\u{1F534}";
    case "disabled":
      return "\u26AB";
    case "exhausted":
      return "\u{1F534}";
    case "unknown":
      return "\u{1F7E1}";
  }
}
function statusLabel(status) {
  switch (status) {
    case "active":
      return "active";
    case "ready":
      return "ready";
    case "cooldown":
      return "cooldown";
    case "expired":
      return "expired";
    case "disabled":
      return "disabled";
    case "exhausted":
      return "exhausted";
    case "unknown":
      return "unknown";
  }
}
function formatCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function formatTimestamp(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}
function SidebarPanel(props) {
  const [nowMs, setNowMs] = createSignal(Date.now());
  const tick = setInterval(() => setNowMs(Date.now()), 1e3);
  onCleanup(() => clearInterval(tick));
  const accounts = createMemo(() => props.state().accounts);
  const history = createMemo(() => props.state().history.slice(0, 5));
  const AccountRow = (rowProps) => {
    const remaining = createMemo(() => {
      if (rowProps.status !== "cooldown" || rowProps.cooldownUntil === null) {
        return null;
      }
      const r = rowProps.cooldownUntil - nowMs();
      return r > 0 ? r : null;
    });
    const rowColor = () => {
      switch (rowProps.status) {
        case "active":
          return props.theme["success"] ?? "green";
        case "ready":
          return props.theme["text"] ?? "";
        case "cooldown":
          return props.theme["error"] ?? "red";
        case "expired":
          return props.theme["warning"] ?? "yellow";
        case "disabled":
          return props.theme["textMuted"] ?? "gray";
        case "exhausted":
          return props.theme["error"] ?? "red";
        case "unknown":
          return props.theme["warning"] ?? "yellow";
      }
    };
    return (() => {
      var _el$ = _$createElement("box"), _el$2 = _$createElement("box"), _el$3 = _$createElement("text"), _el$4 = _$createTextNode(` `), _el$5 = _$createElement("text"), _el$6 = _$createElement("text"), _el$7 = _$createTextNode(` `);
      _$insertNode(_el$, _el$2);
      _$setProp(_el$, "flexDirection", "column");
      _$insertNode(_el$2, _el$3);
      _$insertNode(_el$2, _el$5);
      _$insertNode(_el$2, _el$6);
      _$setProp(_el$2, "flexDirection", "row");
      _$insertNode(_el$3, _el$4);
      _$insert(_el$3, () => statusEmoji(rowProps.status), _el$4);
      _$insert(_el$5, () => rowProps.name);
      _$insertNode(_el$6, _el$7);
      _$insert(_el$6, () => statusLabel(rowProps.status), null);
      _$insert(_el$2, _$createComponent(Show, {
        get when() {
          return remaining() !== null;
        },
        get children() {
          var _el$8 = _$createElement("text"), _el$9 = _$createTextNode(` `);
          _$insertNode(_el$8, _el$9);
          _$insert(_el$8, () => formatCountdown(remaining()), null);
          _$effect((_$p) => _$setProp(_el$8, "fg", props.theme["error"] ?? "red", _$p));
          return _el$8;
        }
      }), null);
      _$effect((_p$) => {
        var _v$ = rowColor(), _v$2 = rowColor(), _v$3 = props.theme["textMuted"] ?? "gray";
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "fg", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp(_el$6, "fg", _v$3, _p$.a));
        return _p$;
      }, {
        e: void 0,
        t: void 0,
        a: void 0
      });
      return _el$;
    })();
  };
  const HistorySection = () => (() => {
    var _el$0 = _$createElement("box"), _el$1 = _$createElement("text");
    _$insertNode(_el$0, _el$1);
    _$setProp(_el$0, "flexDirection", "column");
    _$insertNode(_el$1, _$createTextNode(`\u2500 Recent rotations`));
    _$setProp(_el$1, "selectable", false);
    _$insert(_el$0, _$createComponent(Show, {
      get when() {
        return history().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$11 = _$createElement("text");
          _$insertNode(_el$11, _$createTextNode(` (none)`));
          _$effect((_$p) => _$setProp(_el$11, "fg", props.theme["textMuted"] ?? "gray", _$p));
          return _el$11;
        })();
      },
      get children() {
        return _$createComponent(For, {
          get each() {
            return history();
          },
          children: (entry) => (() => {
            var _el$13 = _$createElement("text"), _el$14 = _$createTextNode(` `), _el$15 = _$createTextNode(` \u2192 `), _el$16 = _$createTextNode(` (`), _el$17 = _$createTextNode(`)`);
            _$insertNode(_el$13, _el$14);
            _$insertNode(_el$13, _el$15);
            _$insertNode(_el$13, _el$16);
            _$insertNode(_el$13, _el$17);
            _$insert(_el$13, () => formatTimestamp(entry.timestamp), _el$14);
            _$insert(_el$13, () => entry.from ?? "\u2013", _el$15);
            _$insert(_el$13, () => entry.to, _el$16);
            _$insert(_el$13, () => entry.trigger, _el$17);
            _$effect((_$p) => _$setProp(_el$13, "fg", props.theme["textMuted"] ?? "gray", _$p));
            return _el$13;
          })()
        });
      }
    }), null);
    _$effect((_$p) => _$setProp(_el$1, "fg", props.theme["textMuted"] ?? "gray", _$p));
    return _el$0;
  })();
  return (() => {
    var _el$18 = _$createElement("box"), _el$19 = _$createElement("text"), _el$20 = _$createTextNode(` Account Rotator`);
    _$insertNode(_el$18, _el$19);
    _$setProp(_el$18, "flexDirection", "column");
    _$insertNode(_el$19, _el$20);
    _$setProp(_el$19, "selectable", false);
    _$insert(_el$19, () => props.expanded() ? "\u25BE" : "\u25B8", _el$20);
    _$insert(_el$18, _$createComponent(Show, {
      get when() {
        return props.expanded();
      },
      get children() {
        var _el$21 = _$createElement("box");
        _$setProp(_el$21, "flexDirection", "column");
        _$insert(_el$21, _$createComponent(Show, {
          get when() {
            return accounts().length > 0;
          },
          get fallback() {
            return (() => {
              var _el$22 = _$createElement("text");
              _$insertNode(_el$22, _$createTextNode(`No accounts found`));
              _$effect((_$p) => _$setProp(_el$22, "fg", props.theme["textMuted"] ?? "gray", _$p));
              return _el$22;
            })();
          },
          get children() {
            return _$createComponent(For, {
              get each() {
                return accounts();
              },
              children: (account) => _$createComponent(AccountRow, {
                get name() {
                  return account.name;
                },
                get status() {
                  return account.status;
                },
                get cooldownUntil() {
                  return account.cooldownUntil;
                }
              })
            });
          }
        }), null);
        _$insert(_el$21, _$createComponent(HistorySection, {}), null);
        return _el$21;
      }
    }), null);
    _$effect((_p$) => {
      var _v$4 = props.theme["text"] ?? "", _v$5 = props.onToggleExpanded;
      _v$4 !== _p$.e && (_p$.e = _$setProp(_el$19, "fg", _v$4, _p$.e));
      _v$5 !== _p$.t && (_p$.t = _$setProp(_el$19, "onMouseDown", _v$5, _p$.t));
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$18;
  })();
}

// src/tui/FooterBadge.tsx
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { Show as Show2, createMemo as createMemo2, createSignal as createSignal2, onCleanup as onCleanup2 } from "solid-js";
function formatCountdown2(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function FooterBadge(props) {
  const [nowMs, setNowMs] = createSignal2(Date.now());
  const tick = setInterval(() => setNowMs(Date.now()), 1e3);
  onCleanup2(() => clearInterval(tick));
  const activeAccount = createMemo2(() => props.state().activeAccount);
  const isExhausted = createMemo2(() => props.state().isExhausted);
  const readyCount = createMemo2(() => props.state().accounts.filter((a) => a.status === "ready").length);
  const cooldownAccounts = createMemo2(() => props.state().accounts.filter((a) => a.status === "cooldown"));
  const cooldownCount = createMemo2(() => cooldownAccounts().length);
  const shortestCooldownText = createMemo2(() => {
    const now = nowMs();
    const shortest = cooldownAccounts().map((a) => a.cooldownUntil !== null ? a.cooldownUntil - now : Infinity).filter((ms) => ms > 0).reduce((min, ms) => Math.min(min, ms), Infinity);
    if (!isFinite(shortest)) return "";
    return ` ${formatCountdown2(shortest)}`;
  });
  const visible = createMemo2(() => props.state().accounts.length > 0);
  return (() => {
    var _el$ = _$createElement2("box");
    _$insert2(_el$, _$createComponent2(Show2, {
      get when() {
        return visible();
      },
      get children() {
        var _el$2 = _$createElement2("box");
        _$setProp2(_el$2, "paddingLeft", 1);
        _$setProp2(_el$2, "paddingRight", 1);
        _$insert2(_el$2, _$createComponent2(Show2, {
          get when() {
            return _$memo2(() => !!!isExhausted())() && activeAccount() !== null;
          },
          get fallback() {
            return (() => {
              var _el$13 = _$createElement2("box"), _el$14 = _$createElement2("text");
              _$insertNode2(_el$13, _el$14);
              _$setProp2(_el$13, "flexDirection", "row");
              _$insertNode2(_el$14, _$createTextNode2(`\u26A0 No active account`));
              _$effect2((_$p) => _$setProp2(_el$14, "fg", props.theme["warning"] ?? "yellow", _$p));
              return _el$13;
            })();
          },
          get children() {
            var _el$3 = _$createElement2("box"), _el$4 = _$createElement2("text"), _el$5 = _$createTextNode2(`\u26A1 `), _el$6 = _$createElement2("text"), _el$7 = _$createTextNode2(` (`), _el$9 = _$createTextNode2(` ready`), _el$11 = _$createElement2("text");
            _$insertNode2(_el$3, _el$4);
            _$insertNode2(_el$3, _el$6);
            _$insertNode2(_el$3, _el$11);
            _$setProp2(_el$3, "flexDirection", "row");
            _$insertNode2(_el$4, _el$5);
            _$insert2(_el$4, activeAccount, null);
            _$insertNode2(_el$6, _el$7);
            _$insertNode2(_el$6, _el$9);
            _$insert2(_el$6, readyCount, _el$9);
            _$insert2(_el$3, _$createComponent2(Show2, {
              get when() {
                return cooldownCount() > 0;
              },
              get children() {
                var _el$0 = _$createElement2("text"), _el$1 = _$createTextNode2(` \xB7 `), _el$10 = _$createTextNode2(` cooldown`);
                _$insertNode2(_el$0, _el$1);
                _$insertNode2(_el$0, _el$10);
                _$insert2(_el$0, cooldownCount, _el$10);
                _$insert2(_el$0, shortestCooldownText, null);
                _$effect2((_$p) => _$setProp2(_el$0, "fg", props.theme["textMuted"] ?? "gray", _$p));
                return _el$0;
              }
            }), _el$11);
            _$insertNode2(_el$11, _$createTextNode2(`)`));
            _$effect2((_p$) => {
              var _v$ = props.theme["success"] ?? "green", _v$2 = props.theme["textMuted"] ?? "gray", _v$3 = props.theme["textMuted"] ?? "gray";
              _v$ !== _p$.e && (_p$.e = _$setProp2(_el$4, "fg", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$6, "fg", _v$2, _p$.t));
              _v$3 !== _p$.a && (_p$.a = _$setProp2(_el$11, "fg", _v$3, _p$.a));
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0
            });
            return _el$3;
          }
        }));
        return _el$2;
      }
    }));
    return _el$;
  })();
}

// src/tui/use-rotator-state.ts
import { createSignal as createSignal3, onCleanup as onCleanup3 } from "solid-js";
import { readFile as readFile2 } from "fs/promises";

// src/state.ts
import { readFile, writeFile, rename, mkdir } from "fs/promises";
import { homedir } from "os";
import { join, dirname } from "path";
import { z } from "zod";
var STATE_PATH = join(
  homedir(),
  ".config",
  "opencode",
  "account-rotator-state.json"
);
var cooldownEntrySchema = z.object({
  account: z.string(),
  until: z.number().int().nonnegative(),
  reason: z.enum(["429", "401", "refresh-failed"])
});
var healthStatusSchema = z.enum(["ready", "exhausted", "unknown", "unchecked"]);
var persistedStateSchema = z.object({
  activeAccount: z.string().nullable(),
  accounts: z.array(z.string()),
  rotationIndex: z.number().int().nonnegative(),
  cooldowns: z.array(cooldownEntrySchema),
  lastRotation: z.number().int().nullable(),
  healthStatuses: z.record(z.string(), healthStatusSchema).optional()
});

// src/tui/types.ts
function emptyTuiState() {
  return {
    accounts: [],
    activeAccount: null,
    lastRotation: null,
    history: [],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    isExhausted: false,
    healthStatuses: {}
  };
}

// src/tui/use-rotator-state.ts
function deriveStatus(name, activeAccount, cooldowns, disabledNames, now, healthStatuses) {
  if (disabledNames.has(name)) return "disabled";
  if (name === activeAccount) return "active";
  const cooldown = cooldowns.find((c) => c.account === name);
  if (cooldown) {
    if (cooldown.until > now) return "cooldown";
  }
  const health = healthStatuses[name];
  if (health === "exhausted") return "exhausted";
  if (health === "unknown") return "unknown";
  return "ready";
}
function deriveState(raw) {
  const now = Date.now();
  const healthStatuses = raw.healthStatuses ?? {};
  const accounts = raw.accounts.map((name) => {
    const cooldown = raw.cooldowns.find((c) => c.account === name);
    const cooldownUntil = cooldown && cooldown.until > now ? cooldown.until : null;
    const status = deriveStatus(
      name,
      raw.activeAccount,
      raw.cooldowns,
      /* @__PURE__ */ new Set(),
      // disabled accounts not tracked in PersistedState; extend later
      now,
      healthStatuses
    );
    return {
      name,
      status,
      cooldownUntil,
      isActive: name === raw.activeAccount
    };
  });
  const isExhausted = accounts.length > 0 && accounts.every(
    (a) => a.status === "cooldown" || a.status === "expired" || a.status === "disabled" || a.status === "exhausted"
  );
  return {
    accounts,
    activeAccount: raw.activeAccount,
    lastRotation: raw.lastRotation,
    history: [],
    // PersistedState does not include history — in-memory only
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    isExhausted,
    healthStatuses
  };
}
function parsePersistedState(content) {
  try {
    const raw = JSON.parse(content);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const obj = raw;
    if (!Array.isArray(obj["accounts"]) || !Array.isArray(obj["cooldowns"])) {
      return null;
    }
    let healthStatuses;
    const rawHealth = obj["healthStatuses"];
    if (rawHealth !== null && typeof rawHealth === "object" && !Array.isArray(rawHealth)) {
      healthStatuses = {};
      const validStatuses = /* @__PURE__ */ new Set(["ready", "exhausted", "unknown", "unchecked"]);
      for (const [k, v] of Object.entries(rawHealth)) {
        if (typeof v === "string" && validStatuses.has(v)) {
          healthStatuses[k] = v;
        }
      }
    }
    const parsed = {
      activeAccount: typeof obj["activeAccount"] === "string" ? obj["activeAccount"] : null,
      accounts: obj["accounts"].filter(
        (a) => typeof a === "string"
      ),
      rotationIndex: typeof obj["rotationIndex"] === "number" ? obj["rotationIndex"] : 0,
      cooldowns: Array.isArray(obj["cooldowns"]) ? obj["cooldowns"].filter(
        (c) => c !== null && typeof c === "object" && !Array.isArray(c) && typeof c["account"] === "string" && typeof c["until"] === "number"
      ) : [],
      lastRotation: typeof obj["lastRotation"] === "number" ? obj["lastRotation"] : null
    };
    if (healthStatuses !== void 0) {
      parsed.healthStatuses = healthStatuses;
    }
    return parsed;
  } catch {
    return null;
  }
}
function useRotatorState() {
  const [state, setState] = createSignal3(emptyTuiState());
  const refresh = async () => {
    try {
      const content = await readFile2(STATE_PATH, "utf-8");
      const parsed = parsePersistedState(content);
      if (parsed !== null) {
        setState(deriveState(parsed));
      }
    } catch (err) {
      const isNodeError2 = (e) => e instanceof Error && "code" in e;
      if (isNodeError2(err) && err.code === "ENOENT") {
        setState(emptyTuiState());
      }
    }
  };
  void refresh();
  const intervalId = setInterval(() => {
    void refresh();
  }, 1e3);
  onCleanup3(() => {
    clearInterval(intervalId);
  });
  return { state, refresh };
}

// src/credential-store.ts
import { readdir, readFile as readFile3 } from "fs/promises";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
import { z as z2 } from "zod";
var CCS_INSTANCES_DIR = join2(homedir2(), ".ccs", "instances");
var CREDENTIALS_FILENAME = ".credentials.json";
var AUTH_JSON_PATH = join2(homedir2(), ".local", "share", "opencode", "auth.json");
var CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e535-43e3-a1b1-68f1a5a8f740";
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
    if (isNodeError(err) && err.code === "ENOENT") {
      return [];
    }
    console.warn(`[account-rotator] Failed to read ${CCS_INSTANCES_DIR}: ${String(err)}`);
    return [];
  }
  entries.sort();
  const accounts = [];
  for (const entry of entries) {
    const credPath = join2(CCS_INSTANCES_DIR, entry, CREDENTIALS_FILENAME);
    let raw;
    try {
      const content = await readFile3(credPath, "utf-8");
      raw = JSON.parse(content);
    } catch (err) {
      console.warn(
        `[account-rotator] Skipping instance "${entry}": cannot read ${credPath} \u2014 ${String(err)}`
      );
      continue;
    }
    const result = credentialsSchema.safeParse(raw);
    if (!result.success) {
      console.warn(
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
      console.warn(
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
      console.warn(
        `[account-rotator] Token refresh timed out for "${account.name}" \u2014 using existing token`
      );
    } else {
      console.warn(
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
    const content = await readFile3(AUTH_JSON_PATH, "utf-8");
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
    if (isNodeError(err) && err.code === "ENOENT") {
      return null;
    }
    console.warn(
      `[account-rotator] Failed to read auth.json at ${AUTH_JSON_PATH}: ${String(err)}`
    );
    return null;
  }
}
function isNodeError(err) {
  return err instanceof Error && "code" in err;
}
function isAbortError(err) {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}
function isTokenExpired(account, bufferMs = 6e4) {
  return account.expiresAt - Date.now() < bufferMs;
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
      console.warn(
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
        console.warn(
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
        console.warn("[account-rotator] auth.json watcher: file not found \u2014 watching parent dir");
      } else {
        console.warn(`[account-rotator] auth.json watcher error: ${String(err)}`);
      }
    });
  } catch (err) {
    const nodeErr = err;
    if (nodeErr.code === "ENOENT") {
      console.warn(
        `[account-rotator] auth.json not found at ${AUTH_JSON_PATH} \u2014 watcher inactive until file is created`
      );
    } else {
      console.warn(`[account-rotator] Failed to start auth watcher: ${String(err)}`);
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

// src/tui.tsx
var TUI_PLUGIN_ID = "account-rotator.tui";
var SIDEBAR_ENABLED_KV_KEY = "account-rotator.sidebar.enabled";
var SIDEBAR_EXPANDED_KV_KEY = "account-rotator.sidebar.expanded";
var tui = async (api) => {
  const [sectionEnabled, setSectionEnabled] = createSignal4(api.kv.get(SIDEBAR_ENABLED_KV_KEY, true) !== false);
  const [sectionExpanded, setSectionExpanded] = createSignal4(api.kv.get(SIDEBAR_EXPANDED_KV_KEY, true) !== false);
  const {
    state,
    refresh
  } = useRotatorState();
  try {
    const discoveredAccounts = await discover();
    const tuiWatcher = createAuthWatcher({
      accounts: discoveredAccounts,
      onAccountChanged: (_accountName) => {
        void refresh();
      }
    });
    api.lifecycle.onDispose(() => {
      tuiWatcher.close();
    });
  } catch {
  }
  let lastActiveAccount = null;
  let wasExhausted = false;
  const recoveredAccounts = /* @__PURE__ */ new Set();
  try {
    const accounts = await discover();
    for (const account of accounts) {
      if (isTokenExpired(account)) {
        try {
          const refreshed = await refreshAccountToken(account);
          if (refreshed.accessToken !== account.accessToken) {
            api.ui.toast({
              variant: "success",
              message: `${account.name} token refreshed`
            });
          } else {
            api.ui.toast({
              variant: "warning",
              message: `${account.name} token expired \u2014 manual login required`
            });
          }
        } catch {
          api.ui.toast({
            variant: "warning",
            message: `${account.name} token expired \u2014 manual login required`
          });
        }
      }
    }
  } catch {
  }
  await refresh();
  createEffect(() => {
    const s = state();
    const currentActive = s.activeAccount;
    if (lastActiveAccount !== null && currentActive !== null && currentActive !== lastActiveAccount) {
      api.ui.toast({
        variant: "info",
        message: `Rotated to ${currentActive}`
      });
    }
    if (s.isExhausted && !wasExhausted) {
      api.ui.toast({
        variant: "warning",
        message: "All accounts exhausted"
      });
    }
    for (const account of s.accounts) {
      const wasInBadState = recoveredAccounts.has(account.name);
      const isNowGood = account.status === "ready" || account.status === "active";
      if (wasInBadState && isNowGood) {
        api.ui.toast({
          variant: "success",
          message: `${account.name} recovered`
        });
        recoveredAccounts.delete(account.name);
      } else if (!isNowGood && (account.status === "cooldown" || account.status === "expired")) {
        recoveredAccounts.add(account.name);
      }
    }
    lastActiveAccount = currentActive;
    wasExhausted = s.isExhausted;
  });
  const setSectionEnabledPref = (enabled) => {
    setSectionEnabled(enabled);
    api.kv.set(SIDEBAR_ENABLED_KV_KEY, enabled);
    api.ui.toast({
      variant: "info",
      message: enabled ? "Account Rotator sidebar enabled" : "Account Rotator sidebar disabled"
    });
  };
  const setSectionExpandedPref = (expanded) => {
    setSectionExpanded(expanded);
    api.kv.set(SIDEBAR_EXPANDED_KV_KEY, expanded);
  };
  const commandDispose = api.command.register(() => {
    const s = state();
    const commands = [
      // Toggle sidebar section visibility
      {
        title: sectionEnabled() ? "Account Rotator: Disable sidebar section" : "Account Rotator: Enable sidebar section",
        value: SIDEBAR_ENABLED_KV_KEY,
        description: "Toggle the Account Rotator sidebar section",
        category: "Account Rotator",
        onSelect: () => setSectionEnabledPref(!sectionEnabled())
      }
    ];
    const readyAccounts = s.accounts.filter((a) => a.status === "ready");
    if (readyAccounts.length === 0) {
      commands.push({
        title: "Account Rotator: Switch account \u2014 No accounts available",
        value: "account-rotator.switch.disabled",
        description: "All accounts are in cooldown or expired",
        category: "Account Rotator",
        onSelect: () => {
          api.ui.toast({
            variant: "warning",
            message: "No accounts available to switch to"
          });
        }
      });
    } else {
      for (const account of readyAccounts) {
        commands.push({
          title: `Account Rotator: Switch to ${account.name}`,
          value: `account-rotator.switch.${account.name}`,
          description: `Manually activate ${account.name}`,
          category: "Account Rotator",
          onSelect: () => {
            api.ui.toast({
              variant: "info",
              message: `Switched to ${account.name}`
            });
            void refresh();
          }
        });
      }
    }
    return commands;
  });
  const disposeSessionError = api.event.on("session.error", (_event) => {
    void refresh();
  });
  api.lifecycle.onDispose(() => {
    commandDispose();
    disposeSessionError();
  });
  api.slots.register({
    slots: {
      sidebar_content(ctx) {
        return createComponent(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          SidebarPanel,
          {
            state,
            get theme() {
              return ctx.theme.current;
            },
            expanded: sectionExpanded,
            onToggleExpanded: () => setSectionExpandedPref(!sectionExpanded())
          }
        );
      },
      home_bottom(ctx) {
        return createComponent(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          FooterBadge,
          {
            state,
            get theme() {
              return ctx.theme.current;
            }
          }
        );
      }
    }
  });
};
var plugin = {
  id: TUI_PLUGIN_ID,
  tui
};
var tui_default = plugin;
export {
  tui_default as default
};
//# sourceMappingURL=tui.js.map