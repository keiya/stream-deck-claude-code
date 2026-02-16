# CLAUDE.md

Guidelines for AI assistants generating code in this repository.

This project is a **Stream Deck Plus plugin** (`@elgato/streamdeck` SDK + TypeScript + Rollup).
It monitors Claude Code session status and displays it on Stream Deck buttons/LCD.
All generated code should follow the rules below unless the user explicitly asks otherwise.

---

## 1. General Principles

- Prefer **clarity over cleverness**.
- Assume **Node.js 20+** runtime (Stream Deck plugin runs in Node, not browser).
- Code must be:
  - Type-safe (`strict: true` in `tsconfig.json` assumed)
  - Small and composable
  - Easy to skim and modify later

When in doubt, write the code as if a mid-level dev will maintain it for years.

---

## 2. TypeScript Style

### 2.1 Language level

- Target **ES2022** modules:
  - Use `const` / `let`, never `var`.
  - Use **arrow functions** for inline callbacks and simple utilities.
  - Use **optional chaining** and **nullish coalescing** where appropriate.
  - Prefer `for...of`, `Array.prototype.map/filter/reduce` over manual `for` loops, unless performance-critical.

### 2.2 Types

- `strict: true` is assumed.
- Avoid `any` and `unknown` unless absolutely necessary.
  - If you must use `any`, add a short comment why.
- Prefer **type aliases** for most cases:

  ```ts
  type SessionState = "idle" | "thinking" | "permission" | "compacting" | "done" | "error" | "offline";
  ```

- Use `interface` mainly for:
  - Public shapes (API-like)
  - Objects that are likely to be extended

- Narrow types as early as possible with type guards instead of casting:

  ```ts
  if (typeof value !== "string") return;
  ```

- Use enums **only** if you need a runtime object. Otherwise use union string literals.

- Array/object index access may return `undefined` — always check:

  ```ts
  const first = arr[0];
  if (first === undefined) return;
  ```

- Use `import type` for type-only imports:

  ```ts
  import type { SessionState } from "./types";
  ```

- Catch variables are `unknown` — narrow before use:

  ```ts
  catch (e) {
    if (e instanceof Error) console.error(e.message);
  }
  ```

### 2.3 Functions and modules

- Prefer small, single-purpose functions.
- Keep modules focused (see Section 7 for directory layout).

---

## 3. Stream Deck SDK Conventions

- Use `@elgato/streamdeck` v2 SDK patterns.
- Actions must implement the appropriate SDK interfaces (`SingletonAction`, etc.).
- Use `@action` decorator for action registration.
- Use `streamDeck.logger` for logging, not `console.log`.

---

## 4. State Model

### 4.1 Session state machine

Valid transitions:

```
offline -> idle -> thinking -> idle | done | error | offline

thinking -> permission -> thinking         (after approval)
thinking -> compacting -> idle             (compaction completes, next idle signal)
done     -> thinking | offline             (done does NOT transition to idle)
permission -> offline
compacting -> offline
*          -> offline                        (session end, always valid)
```

Notes:
- `compacting` returns to `idle` on the next idle-related event or via optional TTL fallback.
- `permission` returns to `thinking` when the user approves.
- `done` stays until a new prompt (`thinking`) or session end/acknowledge (`offline`). `idle` signals after `done` are rejected.
- Do not invent new states. If a new state is needed, update this section first.

### 4.2 StateUpdate payload

```ts
interface StateUpdate {
  slot?: number;        // 1..8 (required if session_id not provided)
  session_id?: string;  // iTerm2 session UUID (required if slot not provided)
  state: SessionState;
  ts?: number;          // Date.now() — set by server if missing
  project?: string;     // project/directory name
  detail?: string;      // e.g. current tool name
  prompt?: string;      // latest user prompt text
}
```

- Either `slot` or `session_id` must be provided (at least one required).
- `slot` takes priority over `session_id` if both are present.
- `session_id` is resolved to a slot via the mapping sent by the iTerm2 Python daemon.
- If `session_id` cannot be resolved (daemon not running or mapping not yet received), the update is silently dropped.

### 4.5 State colors

| State        | Color     | Hex       |
|-------------|-----------|-----------|
| idle        | Orange    | `#FF9800` |
| thinking    | Blue      | `#2196F3` |
| permission  | Amber     | `#FFC107` |
| compacting  | Purple    | `#9C27B0` |
| done        | Green     | `#4CAF50` |
| error       | Red       | `#F44336` |
| offline     | Black     | `#000000` |

### 4.3 Same-state updates

A transition to the **same** state (e.g. `thinking → thinking`) is allowed.
This is used to update `detail` or `project` without changing state.

### 4.4 Responsibility split

- `state.ts` holds **pure state only** — no timers, no visual effects.
- Blink, pulse, or any time-based visual behavior belongs in `actions/*`.

---

## 5. HTTP Server Rules

- The plugin embeds an HTTP server on `127.0.0.1:51820`.
- Bind to **`127.0.0.1` only** — never `0.0.0.0`.
- Use Node.js built-in `node:http` — no Express or other HTTP frameworks.
- **`Content-Type: application/json`** only. Reject other content types.
- **Max body size: 64 KB**. Drop connections that exceed this.
- Always validate incoming payloads before processing.

### Endpoints (exhaustive — do not add endpoints without updating this list)

| Method | Path        | Description                                    |
|--------|-------------|------------------------------------------------|
| POST   | `/state`    | Receive state update from hook (slot or session_id) |
| GET    | `/state`    | Debug: return all slot states                  |
| POST   | `/sessions` | Receive session→slot mapping from iTerm2 daemon |

---

## 6. SVG Image Generation

- Button images are dynamically generated SVG strings passed to `setImage()`.
- Keep SVG templates readable — use template literals with clear structure.
- Color constants must be defined in `types.ts`, not hardcoded in SVG functions.

---

## 7. Code Organization

```
src/
  plugin.ts              # Entry point: HTTP server + action registration + streamDeck.connect()
  types.ts               # SessionState, StateUpdate, SessionMapping, color constants
  state.ts               # SessionStore (slot state + session mapping) + listener pattern
  svg.ts                 # SVG generation (slot number + project name + state color)
  iterm.ts               # osascript for iTerm2 tab switching
  server.ts              # HTTP server (127.0.0.1:51820) — /state + /sessions
  actions/
    claude-session.ts        # Keypad action (buttons)
    claude-session-dial.ts   # Encoder action (LCD dials)
iterm2/
  claude-status.py       # iTerm2 Python API daemon (AutoLaunch script)
com.keiya.claude-status.sdPlugin/
  manifest.json
  layouts/
    session-info.json    # LCD custom layout
  imgs/                  # Placeholder icons
  ui/
    session.html         # Property Inspector: slot selection
    session-dial.html    # Property Inspector: dial config
```

New logic should be attached to the **closest relevant layer** instead of putting everything into `plugin.ts`.

---

## 8. Build System

- **Rollup** bundles `src/plugin.ts` → `com.keiya.claude-status.sdPlugin/bin/plugin.js`.
- Do not introduce Webpack, esbuild, or other bundlers.
- `npm run build` must produce a working plugin with no warnings.

---

## 9. iTerm2 Integration

- `iterm.ts` calls `osascript` for tab switching.
- AppleScript **will fail** (no Automation permission, iTerm not running, no matching tab).
- On failure: **log the error and return gracefully**. Never throw or crash the plugin.
- Return a result indicating success/failure so callers can decide how to handle it.

---

## 10. Property Inspector Settings

All action settings are defined in `types.ts` as a single type:

```ts
interface ActionSettings {
  slot: number;          // 1..8
}
```

Do not add new settings keys without updating `ActionSettings` in `types.ts` first.

---

## 11. Logging

- Use `streamDeck.logger` exclusively.
- Always include the **slot number** in log messages for traceability.
- Do not log file paths, environment variables, or any user-identifiable information.

---

## 12. How to Modify Existing Code

When the user asks you to update code:

1. **Preserve existing structure** unless they request refactoring.
2. Prefer **minimal diffs**: show only the updated function/module when possible.
3. Do not introduce new dependencies or frameworks unless asked.
4. Respect all rules in this document even when editing small snippets.

---

## 13. Things to Avoid

- `any` or `as unknown as T` abuse.
- `var`, unnecessary polyfills for old Node versions.
- Heavy frameworks (Express, Fastify, etc.) for the internal HTTP server.
- Overly complex metaprogramming or excessive abstraction.
- Hardcoded magic numbers — define constants in `types.ts`.
