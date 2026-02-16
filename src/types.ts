export type SessionState =
  | "idle"
  | "thinking"
  | "permission"
  | "compacting"
  | "done"
  | "error"
  | "offline";

export type SessionInfo = {
  state: SessionState;
  ts: number;
  project?: string;
  detail?: string;
  prompt?: string;
};

export type StateUpdate = {
  slot?: number;        // 1..8 (required if session_id not provided)
  session_id?: string;  // iTerm2 session UUID (required if slot not provided)
  state: SessionState;
  ts?: number;
  project?: string;
  detail?: string;
  prompt?: string;
};

// Mapping sent by iTerm2 Python daemon: session UUID → slot position
export type SessionMapping = Record<string, number>;

export type ActionSettings = {
  slot: number;
};

export const STATE_COLORS: Record<SessionState, string> = {
  idle: "#FF9800",
  thinking: "#2196F3",
  permission: "#FFC107",
  compacting: "#9C27B0",
  done: "#4CAF50",
  error: "#F44336",
  offline: "#000000",
};

export const STATE_LABELS: Record<SessionState, string> = {
  idle: "Idle",
  thinking: "Thinking",
  permission: "Permission",
  compacting: "Compacting",
  done: "Done",
  error: "Error",
  offline: "Offline",
};

export const VALID_STATES = new Set<string>(Object.keys(STATE_COLORS));

export const MIN_SLOT = 1;
export const MAX_SLOT = 8;

export const HTTP_HOST = "127.0.0.1";
export const HTTP_PORT = 51820;
export const MAX_BODY_SIZE = 65536;

export const parseSlot = (value: unknown): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_SLOT && n <= MAX_SLOT ? n : 1;
};

export const isSessionState = (x: unknown): x is SessionState =>
  typeof x === "string" && VALID_STATES.has(x);

export const isValidSessionId = (x: unknown): x is string =>
  typeof x === "string" && x.length > 0 && x.length <= 64;
