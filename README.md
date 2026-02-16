# Claude Status for Stream Deck

Stream Deck Plus plugin that monitors Claude Code session status in real time.

- **Buttons (8 keys)**: colored background per state + slot number + project name
- **LCD dials (4 encoders)**: state, project path, latest prompt text with colored background
- **Press button / dial**: switches to the corresponding iTerm2 tab and acknowledges completed sessions

## States

| State | Color | Hex | Trigger |
|---|---|---|---|
| Idle | Orange | `#FF9800` | Session started / prompt approved |
| Thinking | Blue | `#2196F3` | User submitted prompt / tool running |
| Permission | Amber | `#FFC107` | Waiting for user approval |
| Compacting | Purple | `#9C27B0` | Context compaction in progress |
| Done | Green | `#4CAF50` | Session stopped |
| Error | Red | `#F44336` | (reserved) |
| Offline | Black | `#000000` | No active session |

### State transitions

```
offline → idle → thinking → idle | done | error | offline
thinking → permission → thinking       (user approves)
thinking → compacting → idle           (compaction completes)
done     → thinking | offline          (new prompt or acknowledge)
*        → offline                      (session end, always valid)
```

Key rules:
- **done → idle is blocked**: Once a session is done (green), idle signals are ignored. The session stays green until a new prompt (`thinking`) or explicit acknowledge (`offline`).
- **Button press acknowledges**: Pressing a button or dial on a done/idle slot resets it to offline (black) before switching to the tab.
- **Same-state updates are allowed**: e.g. `thinking → thinking` updates the detail field without changing state.

## Requirements

- macOS 10.15+
- Node.js 20+ (bundled by Stream Deck)
- Stream Deck software 6.5+
- iTerm2 (for tab switching + Python API daemon)
- `jq` (used by hook script and installer) — `brew install jq`

## Quick start

```bash
git clone <repo-url> && cd stereamdeck-claude-code
npm install
npm run build
npm run setup
streamdeck link com.keiya.claude-status.sdPlugin
```

Then:
1. Enable iTerm2 Python API: **iTerm2 > Settings > General > Magic > Enable Python API**
2. Restart iTerm2 (the daemon auto-launches on startup)
3. Open Stream Deck app → drag **Claude Session** onto buttons (set Slot 1-8) and **Claude Session Dial** onto encoders
4. Launch `claude` in any iTerm2 tab — it just works

### What `npm run setup` does

Installs 3 things (idempotent — safe to run multiple times):

| What | Where |
|------|-------|
| Hook script | `~/.claude/hooks/sd-notify.sh` |
| Hook entries (7 events) | `~/.claude/settings.json` (merged, existing hooks preserved) |
| iTerm2 daemon | `~/Library/Application Support/iTerm2/Scripts/AutoLaunch/claude-status.py` |

## How it works

```
iTerm2 Python daemon          Stream Deck Plugin            Claude Code hook
─────────────────────          ──────────────────            ────────────────
Tab change detected   ──POST /sessions──▸  Stores session_id→slot
                                           mapping
                                                  ◂──POST /state──  Sends session_id + state
                                           Resolves to slot
                                           Updates button/LCD
```

1. **iTerm2 daemon** (`claude-status.py`) monitors tab layout via `LayoutChangeMonitor` and `SessionTerminationMonitor`. On any change (tab open/close/reorder), it POSTs the current `{session_id: slot}` mapping to the plugin.

2. **Claude Code hook** (`sd-notify.sh`) fires on every Claude Code event (session start, prompt, tool use, etc.). It reads `ITERM_SESSION_ID` (set automatically by iTerm2 in every shell), extracts the UUID, and POSTs the state update with `session_id`.

3. **Stream Deck plugin** receives both streams. It resolves `session_id → slot` using the daemon's mapping, then updates the corresponding button/LCD. Tab reorder moves data atomically. Tab close sets the old slot to offline.

### Hook event → state mapping

| Hook event | State sent | Extra fields |
|---|---|---|
| `SessionStart` | `idle` | `project` (from `cwd`) |
| `UserPromptSubmit` | `thinking` | `prompt` (first 400 chars) |
| `PreToolUse` | `thinking` | `detail` (tool name) |
| `Notification` (permission_prompt) | `permission` | |
| `Notification` (idle_prompt) | `idle` | |
| `PreCompact` | `compacting` | |
| `Stop` | `done` | |
| `SessionEnd` | `offline` | |

### Carry-forward rules

When a field is omitted from an update:
- `project` — carried forward from previous state
- `prompt` — carried forward from previous state
- `detail` — **NOT** carried forward (transient, clears on next update)

## Display

### Keypad buttons

Each button shows:
- Full-color background matching the current state
- Slot number (1-8) in the top area
- Project directory name (basename of cwd)

### LCD dials (encoders)

Each dial shows a custom layout with 4 text lines on a colored background:

| Line | Content | Example |
|------|---------|---------|
| 1 | State label (bold) | `THINKING` |
| 2 | Project directory | `my-app` |
| 3 | Latest prompt (truncated) | `Fix the LCD dial...` |
| 4 | Detail (tool name) | `Bash` |

## HTTP API

The plugin runs a local HTTP server on `127.0.0.1:51820`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/state` | Return all 8 slot states (debug) |
| `POST` | `/state` | State update from hook |
| `POST` | `/sessions` | Session→slot mapping from iTerm2 daemon |

### POST /state

Update a slot's state. Either `slot` or `session_id` is required (at least one). `slot` takes priority if both are present.

```jsonc
{
  "slot": 1,                    // integer 1-8 (optional if session_id provided)
  "session_id": "UUID-HERE",    // iTerm2 session UUID (optional if slot provided)
  "state": "thinking",          // required: idle|thinking|permission|compacting|done|error|offline
  "ts": 1700000000000,          // optional: timestamp (Date.now()), server sets if missing
  "project": "/path/to/repo",   // optional: project directory
  "detail": "Bash",             // optional: current tool name (transient)
  "prompt": "Fix the bug"       // optional: latest user prompt
}
```

If `session_id` is provided without `slot`, the plugin resolves it via the daemon mapping. If the session is unknown (daemon not running or mapping not yet received), the update is silently dropped.

### POST /sessions

Replace the full session→slot mapping. Sent by the iTerm2 daemon on every tab layout change.

```jsonc
{
  "SESSION-UUID-1": 1,    // session_id → slot number (1-8)
  "SESSION-UUID-2": 2,
  "SESSION-UUID-3": 3
}
```

Sessions that disappear from the mapping (tab closed) have their slot set to offline. Sessions that change slot (tab reorder) have their data moved atomically.

### Test curl commands

```bash
# Get all slot states
curl http://127.0.0.1:51820/state

# Send session mapping (simulates daemon)
curl -X POST http://127.0.0.1:51820/sessions -H 'Content-Type: application/json' \
  -d '{"78EC351B-637F-48E2-BB2A-0067873B9C5F":1,"AABBCCDD-1234-5678-9ABC-DEF012345678":2}'

# State update via session_id (with daemon)
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"session_id":"78EC351B-637F-48E2-BB2A-0067873B9C5F","state":"thinking","prompt":"Fix the bug"}'

# State update via slot (legacy / direct)
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"idle","project":"/Users/you/repos/my-app"}'

curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"thinking","prompt":"Fix the LCD dial display"}'

curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"permission","detail":"execute_bash"}'

curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"compacting"}'

curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"done"}'

curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"error"}'

curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"offline"}'
```

## Architecture

```
src/
  plugin.ts              # Entry: store + actions + HTTP server + connect
  types.ts               # SessionState, StateUpdate, SessionMapping, constants
  state.ts               # SessionStore (slot state + session mapping)
  svg.ts                 # SVG generation for buttons and dial backgrounds
  iterm.ts               # osascript tab switching
  server.ts              # HTTP server on 127.0.0.1:51820 (/state + /sessions)
  actions/
    claude-session.ts        # Keypad action (buttons)
    claude-session-dial.ts   # Encoder action (LCD dials)
hooks/
  sd-notify.sh           # Claude Code hook script (installed to ~/.claude/hooks/)
iterm2/
  claude-status.py       # iTerm2 Python API daemon (AutoLaunch script)
scripts/
  install.sh             # One-shot installer (npm run setup)
```

### State persistence

Slot state is persisted to `~/.cache/claude-status/state.json` on every update. On plugin restart, active states (`thinking`, `permission`, `compacting`) are downgraded to `idle` (session is alive but exact state is unknown). Offline slots are not restored.

## Build

```bash
npm install
npm run build    # rollup → com.keiya.claude-status.sdPlugin/bin/plugin.js
npm test         # vitest (39 tests)
```

## Manual setup (without installer)

<details>
<summary>Click to expand</summary>

### Stream Deck actions

1. Open Stream Deck app
2. Drag **Claude Session** onto a button and set the **Slot** (1-8) in the Property Inspector
3. Drag **Claude Session Dial** onto an encoder for LCD display

### iTerm2 Python daemon

```bash
mkdir -p ~/Library/Application\ Support/iTerm2/Scripts/AutoLaunch
cp iterm2/claude-status.py \
  ~/Library/Application\ Support/iTerm2/Scripts/AutoLaunch/claude-status.py
```

Enable Python API in **iTerm2 > Settings > General > Magic > Enable Python API**, then restart iTerm2.

### Hook script

```bash
mkdir -p ~/.claude/hooks
cp hooks/sd-notify.sh ~/.claude/hooks/sd-notify.sh
chmod +x ~/.claude/hooks/sd-notify.sh
```

### Hook configuration

Add to `~/.claude/settings.json` (new matcher format):

```json
{
  "hooks": {
    "SessionStart":      [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/sd-notify.sh", "async": true }] }],
    "UserPromptSubmit":  [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/sd-notify.sh", "async": true }] }],
    "PreToolUse":        [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/sd-notify.sh", "async": true }] }],
    "Notification":      [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/sd-notify.sh", "async": true }] }],
    "PreCompact":        [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/sd-notify.sh", "async": true }] }],
    "Stop":              [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/sd-notify.sh", "async": true }] }],
    "SessionEnd":        [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/sd-notify.sh", "async": true }] }]
  }
}
```

</details>

## Fallback: manual SD_SLOT (without iTerm2 daemon)

If you don't use iTerm2 or prefer manual control, set `SD_SLOT` before launching:

```bash
SD_SLOT=1 claude
SD_SLOT=2 claude  # in another tab
```

The hook script checks in order: `ITERM_SESSION_ID` → `SD_SLOT` → exit silently.

## Troubleshooting

### Buttons don't update

1. Check the plugin is running: `curl http://127.0.0.1:51820/state` — should return JSON
2. Check hooks are firing: watch Stream Deck plugin logs in `com.keiya.claude-status.sdPlugin/logs/`
3. Verify `ITERM_SESSION_ID` is set: run `echo $ITERM_SESSION_ID` in the terminal — should show `w0t0pN:UUID`

### iTerm2 daemon doesn't start

1. Verify Python API is enabled: **iTerm2 > Settings > General > Magic > Enable Python API**
2. Check the script is in the right location: `ls ~/Library/Application\ Support/iTerm2/Scripts/AutoLaunch/claude-status.py`
3. Try running manually: **iTerm2 > Scripts > AutoLaunch > claude-status**
4. Check iTerm2's script console for errors: **iTerm2 > Scripts > Manage > Console**

### State stuck / stale data

Clear persisted state and reset all slots:

```bash
rm ~/.cache/claude-status/state.json
# Then restart the Stream Deck plugin, or send offline to all slots:
for i in $(seq 1 8); do
  curl -s -X POST http://127.0.0.1:51820/state \
    -H 'Content-Type: application/json' \
    -d "{\"slot\":$i,\"state\":\"offline\"}"
done
```

## License

MIT
