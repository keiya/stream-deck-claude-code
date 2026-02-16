import http from "node:http";
import streamDeck from "@elgato/streamdeck";
import type { SessionStore } from "./state";
import { HTTP_HOST, HTTP_PORT, MAX_BODY_SIZE, MIN_SLOT, MAX_SLOT, isSessionState, isValidSessionId } from "./types";

const logger = streamDeck.logger.createScope("HTTP");

const jsonResponse = (
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void => {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
};

const readBody = (req: http.IncomingMessage): Promise<string | null> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });

type ValidatedUpdate = {
  slot?: number;
  session_id?: string;
  state: string;
  ts?: number;
  project?: string;
  detail?: string;
  prompt?: string;
};

const validateUpdate = (
  body: unknown,
): { ok: true; data: ValidatedUpdate } | { ok: false; error: string } => {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be a JSON object" };
  }

  const obj = body as Record<string, unknown>;

  // slot (optional if session_id is provided)
  const slot = obj["slot"];
  const hasSlot = slot !== undefined;
  if (hasSlot && (typeof slot !== "number" || !Number.isInteger(slot) || slot < MIN_SLOT || slot > MAX_SLOT)) {
    return { ok: false, error: `slot must be integer ${MIN_SLOT}..${MAX_SLOT}` };
  }

  // session_id (optional if slot is provided)
  const sessionId = obj["session_id"];
  const hasSessionId = sessionId !== undefined;
  if (hasSessionId && !isValidSessionId(sessionId)) {
    return { ok: false, error: "session_id must be a non-empty string (max 64 chars)" };
  }

  // At least one of slot or session_id is required
  if (!hasSlot && !hasSessionId) {
    return { ok: false, error: "either slot or session_id is required" };
  }

  // state
  const state = obj["state"];
  if (!isSessionState(state)) {
    return { ok: false, error: "invalid state value" };
  }

  // ts
  const ts = obj["ts"];
  if (ts !== undefined && (typeof ts !== "number" || !Number.isFinite(ts))) {
    return { ok: false, error: "ts must be a finite number" };
  }

  // project
  const project = obj["project"];
  if (project !== undefined && typeof project !== "string") {
    return { ok: false, error: "project must be a string" };
  }

  // detail
  const detail = obj["detail"];
  if (detail !== undefined && typeof detail !== "string") {
    return { ok: false, error: "detail must be a string" };
  }

  // prompt
  const prompt = obj["prompt"];
  if (prompt !== undefined && typeof prompt !== "string") {
    return { ok: false, error: "prompt must be a string" };
  }

  return {
    ok: true,
    data: {
      ...(hasSlot && { slot: slot as number }),
      ...(hasSessionId && { session_id: sessionId as string }),
      state: state as string,
      ...(ts !== undefined && { ts: ts as number }),
      ...(project !== undefined && { project: project as string }),
      ...(detail !== undefined && { detail: detail as string }),
      ...(prompt !== undefined && { prompt: prompt as string }),
    },
  };
};

const validateMapping = (
  body: unknown,
): { ok: true; data: Record<string, number> } | { ok: false; error: string } => {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be a JSON object" };
  }

  const obj = body as Record<string, unknown>;
  const mapping: Record<string, number> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (!isValidSessionId(key)) {
      return { ok: false, error: `invalid session_id key: ${key}` };
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_SLOT || value > MAX_SLOT) {
      return { ok: false, error: `slot for ${key} must be integer ${MIN_SLOT}..${MAX_SLOT}` };
    }
    mapping[key] = value;
  }

  return { ok: true, data: mapping };
};

/** Parse and validate a JSON POST body. Returns parsed object or sends error response. */
const parseJsonBody = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<unknown | null> => {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("application/json")) {
    jsonResponse(res, 400, { ok: false, error: "Content-Type must be application/json" });
    return null;
  }

  const raw = await readBody(req);
  if (raw === null) {
    jsonResponse(res, 400, { ok: false, error: "body too large or unreadable" });
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    jsonResponse(res, 400, { ok: false, error: "invalid JSON" });
    return null;
  }
};

export const createServer = (store: SessionStore): http.Server => {
  const server = http.createServer(async (req, res) => {
    const { method, url } = req;

    // --- /state ---
    if (url === "/state") {
      // GET /state — debug endpoint
      if (method === "GET") {
        jsonResponse(res, 200, { ok: true, data: store.getAll() });
        return;
      }

      // POST /state — state update from hook
      if (method === "POST") {
        const parsed = await parseJsonBody(req, res);
        if (parsed === null) return;

        const result = validateUpdate(parsed);
        if (!result.ok) {
          jsonResponse(res, 400, { ok: false, error: result.error });
          return;
        }

        store.update({
          slot: result.data.slot,
          session_id: result.data.session_id,
          state: result.data.state as import("./types").SessionState,
          ts: result.data.ts,
          project: result.data.project,
          detail: result.data.detail,
          prompt: result.data.prompt,
        });

        const id = result.data.slot !== undefined ? `Slot ${result.data.slot}` : `Session ${result.data.session_id}`;
        logger.info(`${id}: ${result.data.state}`);
        jsonResponse(res, 200, { ok: true });
        return;
      }
    }

    // --- /sessions ---
    if (url === "/sessions") {
      // POST /sessions — mapping update from iTerm2 Python daemon
      if (method === "POST") {
        const parsed = await parseJsonBody(req, res);
        if (parsed === null) return;

        const result = validateMapping(parsed);
        if (!result.ok) {
          jsonResponse(res, 400, { ok: false, error: result.error });
          return;
        }

        store.updateMapping(result.data);
        logger.info(`Session mapping updated: ${Object.keys(result.data).length} sessions`);
        jsonResponse(res, 200, { ok: true });
        return;
      }
    }

    jsonResponse(res, 404, { ok: false, error: "not found" });
  });

  server.listen(HTTP_PORT, HTTP_HOST, () => {
    logger.info(`Listening on ${HTTP_HOST}:${HTTP_PORT}`);
  });

  return server;
};
