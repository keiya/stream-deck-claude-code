import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SessionInfo, SessionState, SessionMapping, StateUpdate } from "./types";
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
  // session_id (UUID) → slot number
  private readonly sessionSlotMap = new Map<string, number>();
  // slot number → session_id (reverse lookup)
  private readonly slotSessionMap = new Map<number, string>();

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

  /** Resolve a session_id to a slot number via the mapping. */
  resolveSlot(sessionId: string): number | undefined {
    return this.sessionSlotMap.get(sessionId);
  }

  /**
   * Update the session→slot mapping (sent by iTerm2 Python daemon).
   * Handles tab reorder (data moves with session) and tab close (old slot → offline).
   */
  updateMapping(mapping: SessionMapping): void {
    const newSessionSlot = new Map<string, number>();
    const newSlotSession = new Map<number, string>();

    // Build new maps from incoming mapping
    for (const [sessionId, slot] of Object.entries(mapping)) {
      if (slot >= MIN_SLOT && slot <= MAX_SLOT) {
        newSessionSlot.set(sessionId, slot);
        newSlotSession.set(slot, sessionId);
      }
    }

    // Snapshot data for sessions that moved (read before any writes)
    const moves = new Map<number, SessionInfo>(); // newSlot → data to place there
    const slotsToNotify = new Set<number>();

    for (const [sessionId, newSlot] of newSessionSlot) {
      const oldSlot = this.sessionSlotMap.get(sessionId);
      if (oldSlot !== undefined && oldSlot !== newSlot) {
        moves.set(newSlot, { ...this.get(oldSlot) });
        slotsToNotify.add(newSlot);
        // Old slot goes offline unless another session now occupies it
        if (!newSlotSession.has(oldSlot)) {
          moves.set(oldSlot, defaultInfo());
          slotsToNotify.add(oldSlot);
        }
      }
    }

    // Detect sessions that disappeared (tab closed)
    for (const [sessionId, oldSlot] of this.sessionSlotMap) {
      if (!newSessionSlot.has(sessionId) && !newSlotSession.has(oldSlot)) {
        moves.set(oldSlot, defaultInfo());
        slotsToNotify.add(oldSlot);
      }
    }

    // Apply all moves atomically
    for (const [slot, info] of moves) {
      this.map.set(slot, info);
    }

    // Replace maps
    this.sessionSlotMap.clear();
    this.slotSessionMap.clear();
    for (const [k, v] of newSessionSlot) this.sessionSlotMap.set(k, v);
    for (const [k, v] of newSlotSession) this.slotSessionMap.set(k, v);

    // Persist and notify after all state is consistent
    if (slotsToNotify.size > 0) {
      this.persist();
      for (const slot of slotsToNotify) {
        this.notify(slot, this.get(slot));
      }
    }
  }

  update(update: StateUpdate): void {
    // Resolve slot: explicit slot takes priority, then session_id lookup
    let slot = update.slot;
    if (slot === undefined && update.session_id !== undefined) {
      slot = this.resolveSlot(update.session_id);
    }
    // Cannot determine slot — silently drop
    if (slot === undefined) return;

    const ts = update.ts ?? Date.now();
    const current = this.get(slot);

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

    this.map.set(slot, info);
    this.persist();
    this.notify(slot, info);
  }

  private notify(slot: number, info: SessionInfo): void {
    for (const fn of this.listeners) {
      fn(slot, info);
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
