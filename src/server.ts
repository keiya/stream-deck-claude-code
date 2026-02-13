import http from "node:http";
import streamDeck from "@elgato/streamdeck";
import type { SessionStore } from "./state";
import { HTTP_HOST, HTTP_PORT, MAX_BODY_SIZE, MIN_SLOT, MAX_SLOT, isSessionState } from "./types";

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

const validateUpdate = (
  body: unknown,
): { ok: true; data: { slot: number; state: string; ts?: number; project?: string; detail?: string; prompt?: string } } | { ok: false; error: string } => {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be a JSON object" };
  }

  const obj = body as Record<string, unknown>;

  // slot
  const slot = obj["slot"];
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < MIN_SLOT || slot > MAX_SLOT) {
    return { ok: false, error: `slot must be integer ${MIN_SLOT}..${MAX_SLOT}` };
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
      slot: slot as number,
      state: state as string,
      ...(ts !== undefined && { ts: ts as number }),
      ...(project !== undefined && { project: project as string }),
      ...(detail !== undefined && { detail: detail as string }),
      ...(prompt !== undefined && { prompt: prompt as string }),
    },
  };
};

export const createServer = (store: SessionStore): http.Server => {
  const server = http.createServer(async (req, res) => {
    const { method, url } = req;

    if (url !== "/state") {
      jsonResponse(res, 404, { ok: false, error: "not found" });
      return;
    }

    // GET /state — debug endpoint
    if (method === "GET") {
      jsonResponse(res, 200, { ok: true, data: store.getAll() });
      return;
    }

    // POST /state — state update
    if (method === "POST") {
      const contentType = req.headers["content-type"] ?? "";
      if (!contentType.startsWith("application/json")) {
        jsonResponse(res, 400, { ok: false, error: "Content-Type must be application/json" });
        return;
      }

      const raw = await readBody(req);
      if (raw === null) {
        jsonResponse(res, 400, { ok: false, error: "body too large or unreadable" });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        jsonResponse(res, 400, { ok: false, error: "invalid JSON" });
        return;
      }

      const result = validateUpdate(parsed);
      if (!result.ok) {
        jsonResponse(res, 400, { ok: false, error: result.error });
        return;
      }

      store.update({
        slot: result.data.slot,
        state: result.data.state as import("./types").SessionState,
        ts: result.data.ts,
        project: result.data.project,
        detail: result.data.detail,
        prompt: result.data.prompt,
      });

      logger.info(`Slot ${result.data.slot}: ${result.data.state}`);
      jsonResponse(res, 200, { ok: true });
      return;
    }

    jsonResponse(res, 404, { ok: false, error: "not found" });
  });

  server.listen(HTTP_PORT, HTTP_HOST, () => {
    logger.info(`Listening on ${HTTP_HOST}:${HTTP_PORT}`);
  });

  return server;
};
