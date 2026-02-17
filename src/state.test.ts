import { describe, it, expect, vi } from "vitest";
import { SessionStore } from "./state";

describe("SessionStore", () => {
  // --- Basic operations ---

  it("initializes all 8 slots as offline", () => {
    const store = new SessionStore();
    for (let slot = 1; slot <= 8; slot++) {
      expect(store.get(slot).state).toBe("offline");
    }
  });

  it("updates a slot and retrieves it", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "idle", project: "/repo" });
    const info = store.get(1);
    expect(info.state).toBe("idle");
    expect(info.project).toBe("/repo");
  });

  it("getAll returns all 8 slots", () => {
    const store = new SessionStore();
    const all = store.getAll();
    expect(Object.keys(all)).toHaveLength(8);
  });

  // --- Listener / subscribe ---

  it("notifies listeners on update", () => {
    const store = new SessionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.update({ slot: 3, state: "thinking" });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(3, expect.objectContaining({ state: "thinking" }));
  });

  it("unsubscribe stops notifications", () => {
    const store = new SessionStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    unsub();
    store.update({ slot: 1, state: "idle" });
    expect(listener).not.toHaveBeenCalled();
  });

  // --- Out-of-order rejection ---

  it("rejects out-of-order updates (older timestamp)", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "idle", ts: 1000 });
    store.update({ slot: 1, state: "thinking", ts: 500 });
    expect(store.get(1).state).toBe("idle");
  });

  it("accepts same-timestamp updates", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "idle", ts: 1000 });
    store.update({ slot: 1, state: "thinking", ts: 1000 });
    expect(store.get(1).state).toBe("thinking");
  });

  // --- done → idle block ---

  it("blocks done → idle transition", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "done", ts: 100 });
    store.update({ slot: 1, state: "idle", ts: 200 });
    expect(store.get(1).state).toBe("done");
  });

  it("allows done → thinking transition", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "done", ts: 100 });
    store.update({ slot: 1, state: "thinking", ts: 200 });
    expect(store.get(1).state).toBe("thinking");
  });

  it("allows done → offline transition", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "done", ts: 100 });
    store.update({ slot: 1, state: "offline", ts: 200 });
    expect(store.get(1).state).toBe("offline");
  });

  it("does not block idle → idle (same-state update)", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "idle", ts: 100 });
    store.update({ slot: 1, state: "idle", ts: 200, project: "/new" });
    expect(store.get(1).state).toBe("idle");
    expect(store.get(1).project).toBe("/new");
  });

  it("does not block thinking → idle", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "thinking", ts: 100 });
    store.update({ slot: 1, state: "idle", ts: 200 });
    expect(store.get(1).state).toBe("idle");
  });

  // --- Carry-forward rules ---

  it("carries forward project when not provided", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "idle", project: "/myproject" });
    store.update({ slot: 1, state: "thinking", ts: Date.now() + 1 });
    expect(store.get(1).project).toBe("/myproject");
  });

  it("carries forward prompt when not provided", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "thinking", prompt: "fix bug", ts: 100 });
    store.update({ slot: 1, state: "done", ts: 200 });
    expect(store.get(1).prompt).toBe("fix bug");
  });

  it("overwrites project when explicitly provided", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "idle", project: "/old", ts: 100 });
    store.update({ slot: 1, state: "thinking", project: "/new", ts: 200 });
    expect(store.get(1).project).toBe("/new");
  });

  it("does NOT carry forward detail (transient)", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "thinking", detail: "Bash", ts: 100 });
    store.update({ slot: 1, state: "thinking", ts: 200 });
    expect(store.get(1).detail).toBeUndefined();
  });

  // --- Slot boundaries ---

  it("slots are independent", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "idle", ts: 100 });
    store.update({ slot: 2, state: "thinking", ts: 100 });
    expect(store.get(1).state).toBe("idle");
    expect(store.get(2).state).toBe("thinking");
    expect(store.get(3).state).toBe("offline");
  });

  it("does not notify listener when update is rejected", () => {
    const store = new SessionStore();
    store.update({ slot: 1, state: "done", ts: 100 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.update({ slot: 1, state: "idle", ts: 200 }); // blocked
    expect(listener).not.toHaveBeenCalled();
  });

  // --- Session ID resolution ---

  it("resolves session_id to slot after mapping is set", () => {
    const store = new SessionStore();
    store.updateMapping({ "abc-123": 1, "def-456": 2 });
    expect(store.resolveSlot("abc-123")).toBe(1);
    expect(store.resolveSlot("def-456")).toBe(2);
  });

  it("returns undefined for unknown session_id", () => {
    const store = new SessionStore();
    store.updateMapping({ "abc-123": 1 });
    expect(store.resolveSlot("unknown")).toBeUndefined();
  });

  it("updates via session_id when mapping exists", () => {
    const store = new SessionStore();
    store.updateMapping({ "abc-123": 2 });
    store.update({ session_id: "abc-123", state: "thinking", ts: 100 });
    expect(store.get(2).state).toBe("thinking");
  });

  it("buffers update when session_id has no mapping, replays on mapping arrival", () => {
    const store = new SessionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.update({ session_id: "unknown-id", state: "thinking", ts: 100 });
    // Not yet delivered — all slots remain offline
    expect(listener).not.toHaveBeenCalled();
    for (let slot = 1; slot <= 8; slot++) {
      expect(store.get(slot).state).toBe("offline");
    }
    // Mapping arrives — buffered update replays
    store.updateMapping({ "unknown-id": 3 });
    expect(store.get(3).state).toBe("thinking");
  });

  it("uses fallback_slot when session_id has no mapping", () => {
    const store = new SessionStore();
    store.update({ session_id: "unmapped", state: "idle", fallback_slot: 4, ts: 100 });
    expect(store.get(4).state).toBe("idle");
  });

  it("prefers session_id mapping over fallback_slot", () => {
    const store = new SessionStore();
    store.updateMapping({ "mapped-id": 2 });
    store.update({ session_id: "mapped-id", state: "thinking", fallback_slot: 5, ts: 100 });
    // session_id resolves to slot 2, fallback_slot 5 is ignored
    expect(store.get(2).state).toBe("thinking");
    expect(store.get(5).state).toBe("offline");
  });

  it("does not overwrite occupied slot via fallback_slot", () => {
    const store = new SessionStore();
    // sess-a occupies slot 2 via mapping
    store.updateMapping({ "sess-a": 2 });
    store.update({ session_id: "sess-a", state: "thinking", project: "/projA", ts: 100 });

    // sess-b tries fallback_slot 2 — should NOT overwrite sess-a
    store.update({ session_id: "sess-b", state: "idle", fallback_slot: 2, ts: 200 });
    expect(store.get(2).state).toBe("thinking");
    expect(store.get(2).project).toBe("/projA");
  });

  it("moves data from fallback_slot to real slot when mapping arrives", () => {
    const store = new SessionStore();
    // Update lands on fallback_slot 2 (no mapping yet)
    store.update({ session_id: "sess-x", state: "thinking", project: "/proj", fallback_slot: 2, ts: 100 });
    expect(store.get(2).state).toBe("thinking");

    // Daemon mapping arrives: sess-x actually belongs in slot 1
    store.updateMapping({ "sess-x": 1 });
    expect(store.get(1).state).toBe("thinking");
    expect(store.get(1).project).toBe("/proj");
    expect(store.get(2).state).toBe("offline");
  });

  it("prefers explicit slot over session_id", () => {
    const store = new SessionStore();
    store.updateMapping({ "abc-123": 2 });
    store.update({ slot: 5, session_id: "abc-123", state: "idle", ts: 100 });
    // slot 5 should be updated, not slot 2
    expect(store.get(5).state).toBe("idle");
    expect(store.get(2).state).toBe("offline");
  });

  // --- updateMapping: tab reorder ---

  it("moves data when session changes slot (tab reorder)", () => {
    const store = new SessionStore();
    store.updateMapping({ "sess-a": 1, "sess-b": 2 });
    store.update({ session_id: "sess-a", state: "thinking", project: "/projA", ts: 100 });
    store.update({ session_id: "sess-b", state: "idle", project: "/projB", ts: 100 });

    // Reorder: swap tabs
    store.updateMapping({ "sess-a": 2, "sess-b": 1 });

    expect(store.get(2).state).toBe("thinking");
    expect(store.get(2).project).toBe("/projA");
    expect(store.get(1).state).toBe("idle");
    expect(store.get(1).project).toBe("/projB");
  });

  it("sets old slot offline when session moves and old slot is unoccupied", () => {
    const store = new SessionStore();
    store.updateMapping({ "sess-a": 1 });
    store.update({ session_id: "sess-a", state: "thinking", ts: 100 });

    // sess-a moves from slot 1 to slot 3
    store.updateMapping({ "sess-a": 3 });

    expect(store.get(3).state).toBe("thinking");
    expect(store.get(1).state).toBe("offline");
  });

  // --- updateMapping: tab close ---

  it("sets slot offline when session disappears (tab closed)", () => {
    const store = new SessionStore();
    store.updateMapping({ "sess-a": 1, "sess-b": 2 });
    store.update({ session_id: "sess-a", state: "idle", ts: 100 });
    store.update({ session_id: "sess-b", state: "thinking", ts: 100 });

    // sess-b closed
    store.updateMapping({ "sess-a": 1 });

    expect(store.get(1).state).toBe("idle");
    expect(store.get(2).state).toBe("offline");
  });

  it("notifies listeners on mapping-triggered changes", () => {
    const store = new SessionStore();
    store.updateMapping({ "sess-a": 1 });
    store.update({ session_id: "sess-a", state: "thinking", ts: 100 });

    const listener = vi.fn();
    store.subscribe(listener);

    // Close tab
    store.updateMapping({});

    expect(listener).toHaveBeenCalledWith(1, expect.objectContaining({ state: "offline" }));
  });

  it("ignores mapping entries with out-of-range slots", () => {
    const store = new SessionStore();
    store.updateMapping({ "sess-a": 0, "sess-b": 9, "sess-c": 3 });
    expect(store.resolveSlot("sess-a")).toBeUndefined();
    expect(store.resolveSlot("sess-b")).toBeUndefined();
    expect(store.resolveSlot("sess-c")).toBe(3);
  });
});
