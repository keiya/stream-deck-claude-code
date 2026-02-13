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
| Offline | Gray | No active session |

## Requirements

- macOS 10.15+
- Node.js 20+ (bundled by Stream Deck)
- Stream Deck software 6.5+
- iTerm2 (for tab switching)

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

### 1. Configure Stream Deck actions

1. Open Stream Deck app
2. Drag **Claude Session** onto a button and set the **Slot** (1-8) in the Property Inspector
3. Drag **Claude Session Dial** onto an encoder for LCD display

### 2. Hook integration

The build step already added hooks to `~/.claude/settings.json` and created `~/.claude/hooks/sd-notify.sh`.

To use, launch Claude Code with the `SD_SLOT` environment variable:

```bash
# Slot 1
SD_SLOT=1 claude

# Slot 2 in another tab
SD_SLOT=2 claude
```

Each slot corresponds to a button/dial on Stream Deck. Up to 8 concurrent sessions are supported.

### Shell alias (optional)

Add to `~/.zshrc` or `~/.bashrc`:

```bash
# Auto-assign SD_SLOT based on iTerm2 tab index
claude-sd() {
  local tab_index
  tab_index=$(osascript -e 'tell application "iTerm2" to tell current window to get index of current tab' 2>/dev/null)
  export SD_SLOT="${tab_index:-1}"
  claude "$@"
}
```

## Architecture

```
src/
  plugin.ts              # Entry: store + actions + HTTP server + connect
  types.ts               # SessionState, StateUpdate, color/label constants
  state.ts               # SessionStore (Map<slot, SessionInfo>)
  svg.ts                 # SVG generation for buttons and dial backgrounds
  iterm.ts               # osascript tab switching (slot 1-based -> tab 0-based)
  server.ts              # HTTP server on 127.0.0.1:51820
  actions/
    claude-session.ts        # Keypad action (buttons)
    claude-session-dial.ts   # Encoder action (LCD dials)
```

### HTTP API

The plugin runs a local HTTP server on `127.0.0.1:51820`.

```bash
# Get all slot states
curl http://127.0.0.1:51820/state
```

#### Test curl commands

```bash
# Idle (orange)
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"idle","project":"/Users/you/repos/my-app"}'

# Thinking (blue)
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"thinking","project":"/Users/you/repos/my-app","prompt":"Fix the LCD dial display"}'

# Permission (amber)
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"permission","project":"/Users/you/repos/my-app","detail":"execute_bash"}'

# Compacting (purple)
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"compacting","project":"/Users/you/repos/my-app"}'

# Done (green)
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"done","project":"/Users/you/repos/my-app"}'

# Error (red)
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"error","project":"/Users/you/repos/my-app"}'

# Offline (gray)
curl -X POST http://127.0.0.1:51820/state -H 'Content-Type: application/json' \
  -d '{"slot":1,"state":"offline"}'
```

## License

MIT
