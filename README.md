# Claude Status for Stream Deck

Stream Deck Plus plugin that monitors Claude Code session status in real time.

- **Buttons (8 keys)**: colored background per state + slot number + project name
- **LCD dials (4 encoders)**: state, project path, latest prompt text with colored background
- **Press button / dial**: switches to the corresponding iTerm2 tab

## States

| State | Color | Trigger |
|---|---|---|
| Idle | Orange | Session started / prompt approved |
| Thinking | Blue | User submitted prompt / tool running |
| Permission | Amber | Waiting for user approval |
| Compacting | Purple | Context compaction in progress |
| Done | Green | Session stopped |
| Error | Red | (reserved) |
| Offline | Black | No active session |

## Requirements

- macOS 10.15+
- Node.js 20+ (bundled by Stream Deck)
- Stream Deck software 6.5+
- iTerm2 (for tab switching + Python API daemon)
- iTerm2 Python Runtime (for automatic session tracking)

## Build

```bash
npm install
npm run build
```

Output: `com.keiya.claude-status.sdPlugin/bin/plugin.js`

## Install

### Option A: Symlink (development)

```bash
# Install the Stream Deck CLI first if you don't have it
npm install -g @elgato/cli

# Create a symlink from the plugins directory to this repo
streamdeck link com.keiya.claude-status.sdPlugin
```

### Option B: Copy (manual)

```bash
cp -r com.keiya.claude-status.sdPlugin \
  ~/Library/Application\ Support/com.elgato.StreamDeck/Plugins/com.keiya.claude-status.sdPlugin
```

After either method, restart the Stream Deck app (or it will detect the new plugin automatically).

## Setup

### Quick setup

```bash
npm install
npm run build
npm run setup
```

This installs everything:
- Hook script → `~/.claude/hooks/sd-notify.sh`
- Hook entries → `~/.claude/settings.json` (7 events, merged non-destructively)
- iTerm2 daemon → `~/Library/Application Support/iTerm2/Scripts/AutoLaunch/claude-status.py`

Then:
1. Enable iTerm2 Python API: **iTerm2 > Settings > General > Magic > Enable Python API**
2. Restart iTerm2
3. Install the Stream Deck plugin: `streamdeck link com.keiya.claude-status.sdPlugin`
4. Add **Claude Session** actions in the Stream Deck app
5. Launch `claude` in any iTerm2 tab — it just works

### How it works

The iTerm2 daemon tracks tab positions and sends `session_id → slot` mappings to the plugin. The Claude Code hook sends `ITERM_SESSION_ID` (set automatically by iTerm2) with each state update. The plugin resolves the session to the correct slot. Tab reorder and close are handled automatically.

### Manual setup (without installer)

<details>
<summary>Click to expand</summary>

#### Stream Deck actions

1. Open Stream Deck app
2. Drag **Claude Session** onto a button and set the **Slot** (1-8) in the Property Inspector
3. Drag **Claude Session Dial** onto an encoder for LCD display

#### iTerm2 Python daemon

```bash
cp iterm2/claude-status.py \
  ~/Library/Application\ Support/iTerm2/Scripts/AutoLaunch/claude-status.py
```

Enable Python API in **iTerm2 > Settings > General > Magic > Enable Python API**, then restart iTerm2.

#### Hook configuration

Add to `~/.claude/settings.json` (uses the new matcher format):

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

### Fallback: manual SD_SLOT (without iTerm2 daemon)

If you don't use iTerm2 or prefer manual control, set `SD_SLOT` before launching:

```bash
SD_SLOT=1 claude
SD_SLOT=2 claude  # in another tab
```

## Architecture

```
src/
  plugin.ts              # Entry: store + actions + HTTP server + connect
  types.ts               # SessionState, StateUpdate, SessionMapping, constants
  state.ts               # SessionStore (slot state + session mapping)
  svg.ts                 # SVG generation for buttons and dial backgrounds
  iterm.ts               # osascript tab switching (slot 1-based → tab 0-based)
  server.ts              # HTTP server on 127.0.0.1:51820
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

### How it works

```
iTerm2 Python daemon          Stream Deck Plugin            Claude Code hook
─────────────────────          ──────────────────            ────────────────
Tab change detected   ──POST /sessions──>  Stores session_id→slot
                                           mapping
                                                  <──POST /state──  Sends session_id + state
                                           Resolves to slot
                                           Updates button/LCD
```

### HTTP API

The plugin runs a local HTTP server on `127.0.0.1:51820`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/state` | Return all slot states (debug) |
| POST | `/state` | State update from hook (slot or session_id) |
| POST | `/sessions` | Session→slot mapping from iTerm2 daemon |

```bash
# Get all slot states
curl http://127.0.0.1:51820/state
```

#### Test curl commands

```bash
# Using slot (legacy)
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"idle","project":"/Users/you/repos/my-app"}'

# Using session_id (with daemon)
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"session_id":"78EC351B-637F-48E2-BB2A-0067873B9C5F","state":"thinking","prompt":"Fix the bug"}'

# Send session mapping (simulates daemon)
curl -X POST http://127.0.0.1:51820/sessions -H 'Content-Type: application/json' \
  -d '{"78EC351B-637F-48E2-BB2A-0067873B9C5F":1,"AABBCCDD-1234-5678-9ABC-DEF012345678":2}'

# State examples by slot
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"thinking","project":"/Users/you/repos/my-app","prompt":"Fix the LCD dial display"}'

curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"permission","project":"/Users/you/repos/my-app","detail":"execute_bash"}'

curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"compacting","project":"/Users/you/repos/my-app"}'

curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"done","project":"/Users/you/repos/my-app"}'

curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"error","project":"/Users/you/repos/my-app"}'

curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"offline"}'
```

## License

MIT
