import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SessionInfo, SessionState, StateUpdate } from "./types";
import { MAX_SLOT, MIN_SLOT, isSessionState } from "./types";

export type SlotListener = (slot: number, info: SessionInfo) => void;

const defaultInfo = (): SessionInfo => ({ state: "offline", ts: 0 });

const CACHE_DIR = join(homedir(), ".cache", "claude-status");
const STATE_FILE = join(CACHE_DIR, "state.json");

// Active states are downgraded to idle on restore — session is alive but exact state unknown
const restoreState = (state: SessionState): SessionState => {
  if (state === "thinking" || state === "permission" || state === "compacting") return "idle";
  return state;
};

export class SessionStore {
  private readonly map: Map<number, SessionInfo>;
  private readonly listeners: Set<SlotListener>;

  constructor() {
    this.map = new Map();
    for (let slot = MIN_SLOT; slot <= MAX_SLOT; slot++) {
      this.map.set(slot, defaultInfo());
    }
    this.listeners = new Set();
  }

  /** Load persisted state from disk. Call before subscribing listeners. */
  loadFromDisk(): number {
    let restored = 0;
    try {
      const raw = readFileSync(STATE_FILE, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return 0;
      const obj = parsed as Record<string, unknown>;
      for (let slot = MIN_SLOT; slot <= MAX_SLOT; slot++) {
        const entry = obj[String(slot)];
        if (typeof entry !== "object" || entry === null) continue;
        const e = entry as Record<string, unknown>;
        if (!isSessionState(e.state)) continue;
        const state = restoreState(e.state);
        // Skip offline slots — no point restoring them
        if (state === "offline") continue;
        const info: SessionInfo = {
          state,
          ts: typeof e.ts === "number" ? e.ts : 0,
          project: typeof e.project === "string" ? e.project : undefined,
          prompt: typeof e.prompt === "string" ? e.prompt : undefined,
        };
        this.map.set(slot, info);
        restored++;
      }
    } catch {
      // File doesn't exist or is invalid — start fresh
    }
    return restored;
  }

  get(slot: number): SessionInfo {
    return this.map.get(slot) ?? defaultInfo();
  }

  getAll(): Record<number, SessionInfo> {
    const result: Record<number, SessionInfo> = {};
    for (const [slot, info] of this.map) {
      result[slot] = info;
    }
    return result;
  }

  subscribe(fn: SlotListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  update(update: StateUpdate): void {
    const ts = update.ts ?? Date.now();
    const current = this.get(update.slot);

    // Reject out-of-order updates
    if (ts < current.ts) return;

    // Block done → idle: done stays until thinking, offline, or error
    if (current.state === "done" && update.state === "idle") return;

    const info: SessionInfo = {
      state: update.state,
      ts,
      // project: carry forward if missing
      project: update.project ?? current.project,
      // detail: transient, NOT carried forward
      detail: update.detail,
      // prompt: carry forward if missing
      prompt: update.prompt ?? current.prompt,
    };

    this.map.set(update.slot, info);
    this.persist();

    for (const fn of this.listeners) {
      fn(update.slot, info);
    }
  }

  private persist(): void {
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(this.getAll(), null, 2));
    } catch {
      // Non-critical — silently ignore persistence failures
    }
  }
}
