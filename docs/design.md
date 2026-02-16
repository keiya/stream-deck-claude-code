# Design Document

Detailed design spec for the Stream Deck Claude Status plugin.
This is the **source of truth** for state model, HTTP API, hook behavior, and session mapping.

> When changing implementation, update this document to match.

---

## 1. State Model

### 1.1 States

| State | Color | Hex | Description |
|---|---|---|---|
| idle | Orange | `#FF9800` | Session started / prompt approved |
| thinking | Blue | `#2196F3` | Prompt submitted / tool running |
| permission | Amber | `#FFC107` | Waiting for user approval |
| compacting | Purple | `#9C27B0` | Context compaction in progress |
| done | Green | `#4CAF50` | Session stopped |
| error | Red | `#F44336` | (reserved) |
| offline | Black | `#000000` | No active session |

Colors and labels are defined in `src/types.ts` (`STATE_COLORS`, `STATE_LABELS`).

### 1.2 Transitions

```
offline → idle → thinking → idle | done | error | offline
thinking → permission → thinking       (user approves)
thinking → compacting → idle           (compaction completes)
done     → thinking | offline          (new prompt or acknowledge)
*        → offline                      (always valid)
```

Rules:
- **done → idle is blocked** at the store level. Done stays until `thinking` or `offline`.
- **Same-state updates allowed** (e.g. `thinking → thinking` to update `detail`).
- **Button/dial press**: if slot is done or idle, resets to offline before switching tab.

### 1.3 Carry-forward

| Field | Carry forward? |
|---|---|
| `project` | Yes — kept from previous state if omitted |
| `prompt` | Yes |
| `detail` | **No** — transient, clears on next update |

### 1.4 Persistence

State persisted to `~/.cache/claude-status/state.json`.
On restore: `thinking`/`permission`/`compacting` downgraded to `idle`. Offline slots not restored.

---

## 2. HTTP API

Server: `127.0.0.1:51820` (node:http, no frameworks).
Content-Type: `application/json` only. Max body: 64 KB.

### 2.1 Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/state` | State update from hook |
| GET | `/state` | Debug: return all 8 slot states |
| POST | `/sessions` | Session→slot mapping from iTerm2 daemon |

### 2.2 POST /state

```jsonc
{
  "slot": 1,                  // int 1-8 (optional if session_id given)
  "session_id": "UUID",       // iTerm2 session UUID (optional if slot given)
  "state": "thinking",        // required
  "ts": 1700000000000,        // optional, server sets if missing
  "project": "/path/to/repo", // optional
  "detail": "Bash",           // optional, transient
  "prompt": "Fix the bug"     // optional
}
```

- At least one of `slot` or `session_id` required.
- `slot` takes priority if both present.
- Unknown `session_id` (no mapping) → silently dropped.

### 2.3 POST /sessions

Full mapping replacement from iTerm2 daemon:

```jsonc
{ "SESSION-UUID-1": 1, "SESSION-UUID-2": 2 }
```

- Sessions removed from mapping → slot goes offline.
- Sessions that change slot → data moved atomically.

---

## 3. Session Mapping (iTerm2 daemon)

`iterm2/claude-status.py` runs as iTerm2 AutoLaunch script.

### 3.1 Flow

```
iTerm2 daemon ──POST /sessions──▸ Plugin stores session_id→slot
                                         ◂──POST /state── Hook sends session_id + state
                                  Plugin resolves → updates slot
```

### 3.2 Binding

- `ITERM_SESSION_ID` env var (format `w0t0p0:UUID`) is set by iTerm2 in every shell.
- Hook extracts UUID portion: `${ITERM_SESSION_ID##*:}`
- Python daemon uses `session.session_id` (UUID only).
- Fallback: `SD_SLOT` env var for manual slot assignment.

### 3.3 Events monitored

- `LayoutChangeMonitor` — tab open, close, reorder
- `SessionTerminationMonitor` — session end (with 100ms debounce)

---

## 4. Hook Script

`hooks/sd-notify.sh` — installed to `~/.claude/hooks/sd-notify.sh`.

### 4.1 Event → state mapping

| Hook event | State | Extra fields |
|---|---|---|
| SessionStart | idle | project (cwd) |
| UserPromptSubmit | thinking | prompt (first 400 chars) |
| PreToolUse | thinking | detail (tool_name) |
| Notification (permission_prompt) | permission | |
| Notification (idle_prompt) | idle | |
| PreCompact | compacting | |
| Stop | done | |
| SessionEnd | offline | |

### 4.2 Hook format (settings.json)

Uses the matcher format:

```json
{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/sd-notify.sh", "async": true }] }
```

---

## 5. Display

### 5.1 Keypad buttons

- Full-color SVG background (`svg.ts`)
- Slot number + project basename as text

### 5.2 LCD dials (encoders)

Custom layout (`layouts/session-info.json`) with 4 text lines on colored bg pixmap:

| Line | Key | Content |
|---|---|---|
| 1 | line1 | State label (bold, 16px) |
| 2 | line2 | Project directory |
| 3 | line3 | Latest prompt |
| 4 | line4 | Detail (tool name) |

Layout rule: bg pixmap at `zOrder: 0`, text items at `zOrder: 1`. Items at the same zOrder must NOT have overlapping rects.

---

## 6. Code Organization

```
src/
  plugin.ts              # Entry point
  types.ts               # Types, constants, validators
  state.ts               # SessionStore (state + session mapping)
  svg.ts                 # SVG generation
  iterm.ts               # osascript tab switching
  server.ts              # HTTP server
  actions/
    claude-session.ts        # Keypad action
    claude-session-dial.ts   # Encoder action
hooks/
  sd-notify.sh           # Hook script (→ ~/.claude/hooks/)
iterm2/
  claude-status.py       # iTerm2 daemon (→ AutoLaunch/)
scripts/
  install.sh             # npm run setup
```
