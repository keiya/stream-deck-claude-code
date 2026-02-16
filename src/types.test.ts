import { describe, it, expect } from "vitest";
import { parseSlot, isSessionState, isValidSessionId } from "./types";

describe("parseSlot", () => {
  it("returns valid slot numbers as-is", () => {
    for (let i = 1; i <= 8; i++) {
      expect(parseSlot(i)).toBe(i);
    }
  });

  it("parses string numbers", () => {
    expect(parseSlot("3")).toBe(3);
  });

  it("defaults to 1 for out-of-range values", () => {
    expect(parseSlot(0)).toBe(1);
    expect(parseSlot(9)).toBe(1);
    expect(parseSlot(-1)).toBe(1);
  });

  it("defaults to 1 for non-numeric values", () => {
    expect(parseSlot(undefined)).toBe(1);
    expect(parseSlot(null)).toBe(1);
    expect(parseSlot("abc")).toBe(1);
  });

  it("defaults to 1 for floats", () => {
    expect(parseSlot(1.5)).toBe(1);
  });
});

describe("isSessionState", () => {
  it("returns true for valid states", () => {
    const valid = ["idle", "thinking", "permission", "compacting", "done", "error", "offline"];
    for (const s of valid) {
      expect(isSessionState(s)).toBe(true);
    }
  });

  it("returns false for invalid values", () => {
    expect(isSessionState("running")).toBe(false);
    expect(isSessionState("")).toBe(false);
    expect(isSessionState(123)).toBe(false);
    expect(isSessionState(null)).toBe(false);
    expect(isSessionState(undefined)).toBe(false);
  });
});

describe("isValidSessionId", () => {
  it("returns true for valid session IDs", () => {
    expect(isValidSessionId("78EC351B-637F-48E2-BB2A-0067873B9C5F")).toBe(true);
    expect(isValidSessionId("abc")).toBe(true);
    expect(isValidSessionId("a".repeat(64))).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isValidSessionId("")).toBe(false);
  });

  it("returns false for strings over 64 chars", () => {
    expect(isValidSessionId("a".repeat(65))).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isValidSessionId(123)).toBe(false);
    expect(isValidSessionId(null)).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
  });
});
