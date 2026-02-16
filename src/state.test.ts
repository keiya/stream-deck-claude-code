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
});
