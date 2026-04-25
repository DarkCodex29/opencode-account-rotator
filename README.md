# opencode-account-rotator

An [OpenCode](https://opencode.ai) plugin that adds **round-robin account rotation** with a **TUI sidebar** on top of [`anthropic-login-via-cli`](https://www.npmjs.com/package/opencode-anthropic-login-via-cli). When any account hits a 429 rate-limit, the plugin automatically switches to the next available account, applies per-account cooldown windows (respecting `Retry-After` headers), and shows live status in the sidebar — all without touching `auth.json` directly.

## Features

- **Automatic 429 rotation** — detects rate limits and switches to the next account
- **TUI sidebar** — live account status with color-coded indicators and cooldown countdowns
- **Footer badge** — compact status line: `⚡ EBIM (2 ready · 1 cooldown 03:42)`
- **Health check** — validates all tokens at startup, refreshes expired ones
- **Smart notifications** — toast alerts for rotations, exhaustion, and recovery
- **Manual switch** — command palette entries to switch accounts on demand
- **Round-robin fairness** — accounts rotate in order, not always falling back to the first
- **State persistence** — rotation index and cooldowns survive restarts

## Install

Add both plugins to your OpenCode config:

**`~/.config/opencode/opencode.json`** — runtime plugin:
```json
{
  "plugin": [
    "opencode-anthropic-login-via-cli@1.6.0",
    "DarkCodex29/opencode-account-rotator"
  ]
}
```

**`~/.config/opencode/tui.json`** — TUI sidebar:
```json
{
  "plugin": ["DarkCodex29/opencode-account-rotator/tui"]
}
```

## CCS Setup (required)

The plugin discovers accounts from `~/.ccs/instances/`. Each Claude Max subscription needs its own instance.

### Step 1: Create instance directories

```bash
mkdir -p ~/.ccs/instances/ebim
mkdir -p ~/.ccs/instances/maximo
mkdir -p ~/.ccs/instances/gian
```

### Step 2: Add credentials for each account

For your **currently active** account (the one in your macOS Keychain), extract and save:

```bash
security find-generic-password -s "Claude Code-credentials" -w \
  | python3 -c "import sys,json; print(json.dumps(json.loads(sys.stdin.read()), indent=2))" \
  > ~/.ccs/instances/ebim/.credentials.json
```

For the **other accounts**, you need to log in with each one:

1. Open [claude.ai](https://claude.ai) → sign out → sign in with the other account
2. Run `claude setup-token` in terminal
3. Extract the new credentials from Keychain:
   ```bash
   security find-generic-password -s "Claude Code-credentials" -w \
     | python3 -c "import sys,json; print(json.dumps(json.loads(sys.stdin.read()), indent=2))" \
     > ~/.ccs/instances/maximo/.credentials.json
   ```
4. Repeat for the third account

Each `.credentials.json` must have this shape:

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1745000000000
  }
}
```

### Step 3: Restart OpenCode

The plugin discovers CCS instances automatically on startup.

## Configuration (optional)

Create `~/.config/opencode/account-rotator.json`:

```json
{
  "accountOrder": ["ebim", "maximo", "gian"],
  "cooldownMs": 300000,
  "maxHistorySize": 50,
  "notifyOnRotation": true,
  "accounts": {
    "gian": { "enabled": true }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `accountOrder` | `[]` (alphabetical) | Preferred rotation order |
| `cooldownMs` | `300000` (5 min) | Default cooldown when no `Retry-After` header |
| `maxHistorySize` | `50` | History entries kept in memory |
| `notifyOnRotation` | `true` | Toast notifications on rotation |
| `accounts` | `{}` | Per-account enabled/disabled flags |

## TUI Sidebar

```
▾ Account Rotator
  🟢 ebim     active
  🟢 maximo   ready
  🟡 gian     cooldown 03:42
  ─ Recent rotations
  14:32 maximo → ebim (429)
  14:28 gian → maximo (429)
```

## Footer Badge

```
⚡ EBIM (2 ready · 1 cooldown 03:42)
```

## Commands

Open the command palette and search "Account Rotator":

- **Account Rotator: Switch to {name}** — manually activate an account
- **Account Rotator: Toggle sidebar** — show/hide the sidebar section

## How It Works

```
OpenCode session.error (429)
         │
         ▼
  account-rotator plugin
         │
         ├─ Mark current account in cooldown (Retry-After or cooldownMs)
         ├─ Pick next available account (round-robin, skip cooldowns)
         ├─ Refresh token if expired (3s timeout)
         ├─ client.auth.set() → swap credentials without restart
         ├─ Save state → account-rotator-state.json
         └─ TUI updates sidebar + footer + toast notification
```

## License

MIT
