# opencode-account-rotator

An [OpenCode](https://opencode.ai) plugin that adds **round-robin account rotation** on top of [`anthropic-login-via-cli`](https://github.com/anthropics/anthropic-login-via-cli). When any account hits a 429 rate-limit, the plugin automatically switches to the next available account, applies per-account cooldown windows (respecting `Retry-After` headers), and emits TUI notifications — all without touching `auth.json` directly.

## Install

```bash
npm install opencode-account-rotator
```

Or add it to your `opencode.json` plugin array:

```json
{
  "plugins": [
    "opencode-account-rotator"
  ]
}
```

## CCS Setup

The plugin reads OAuth credentials from Claude Code Sessions (CCS) instances. Each account needs its own directory under `~/.ccs/instances/`:

```
~/.ccs/instances/
  account-work/
    .credentials.json
  account-personal/
    .credentials.json
```

Each `.credentials.json` must follow this shape (created automatically by `anthropic-login-via-cli`):

```json
{
  "claudeAiOauth": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": 1745000000000
  }
}
```

## Configuration

Create `~/.config/opencode/account-rotator.json` to customize behavior (all fields optional):

```json
{
  "accountOrder": ["account-work", "account-personal"],
  "cooldownMs": 300000,
  "maxHistorySize": 50,
  "notifyOnRotation": true,
  "accounts": {
    "account-personal": { "enabled": false }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `accountOrder` | `[]` (alphabetical) | Preferred rotation order — array of CCS instance names |
| `cooldownMs` | `300000` (5 min) | Default cooldown when no `Retry-After` header is present |
| `maxHistorySize` | `50` | Maximum rotation history entries kept in memory |
| `notifyOnRotation` | `true` | Emit TUI toast notifications on rotation |
| `accounts` | `{}` | Per-account enabled/disabled flags |

## How It Works

```
OpenCode session.error (429)
         │
         ▼
  account-rotator plugin
         │
         ├─ Mark current account in cooldown (Retry-After or cooldownMs)
         │
         ├─ Pick next available account (round-robin, skip cooldowns)
         │
         ├─ Refresh token if expired (3s timeout, in-memory only)
         │
         ├─ client.auth.set({ path: { id: "anthropic" }, body: { ... } })
         │
         ├─ Save rotation state (index + cooldowns → account-rotator-state.json)
         │
         └─ TUI toast: "🔄 Rate limit hit — switched to account-work (2/3)"
```

If **all accounts** are exhausted, the plugin emits `⛔ All accounts exhausted. Retry in Xs` and schedules an automatic re-enable when the shortest cooldown expires.

## License

MIT
