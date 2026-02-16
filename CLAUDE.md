# CLAUDE.md

Guidelines for AI assistants working on this codebase.

This is a **Stream Deck Plus plugin** (`@elgato/streamdeck` SDK + TypeScript + Rollup).
Detailed design spec lives in **`docs/design.md`** — update it when changing behavior.

---

## Coding Rules

- **Node.js 20+**, ES2022, `strict: true`
- `const`/`let` only, arrow functions for callbacks, optional chaining, nullish coalescing
- Prefer **type aliases** over interfaces. Avoid `any`. Use `import type` for type-only imports.
- Narrow with type guards, not casts. Catch variables are `unknown`.
- Small single-purpose functions. Keep modules focused.

## Stream Deck SDK

- `@elgato/streamdeck` v2, `SingletonAction`, `@action` decorator
- `streamDeck.logger` for logging (include slot number), never `console.log`
- No logging of file paths, env vars, or user-identifiable info

## Architecture

- `state.ts` = pure state only (no timers, no visuals)
- `actions/*` = visual behavior (blink, pulse, etc.)
- `types.ts` = all types, constants, validators — add new constants here
- `server.ts` = HTTP server (node:http only, no frameworks, 127.0.0.1 only)
- `svg.ts` = SVG generation, colors from `types.ts`

## Key Constraints

- HTTP server: `127.0.0.1:51820`, JSON only, 64 KB max body
- Rollup bundles to `com.keiya.claude-status.sdPlugin/bin/plugin.js` — no other bundlers
- `iterm.ts`: osascript may fail — log and return gracefully, never throw
- LCD layout zOrder: bg pixmap at 0, text at 1, no overlapping rects at same zOrder

## When Modifying Code

1. Preserve existing structure unless asked to refactor
2. Minimal diffs — don't touch code you didn't change
3. No new dependencies without asking
4. **Update `docs/design.md`** if you change state model, API, hook behavior, or display
