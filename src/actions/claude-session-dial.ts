import streamDeck, {
  action,
  DialDownEvent,
  DialRotateEvent,
  SingletonAction,
  WillAppearEvent,
  DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type { FeedbackPayload } from "@elgato/streamdeck";
import type { ActionSettings, SessionInfo } from "../types";
import { parseSlot, STATE_COLORS, STATE_LABELS, MIN_SLOT, MAX_SLOT } from "../types";
import { switchToTab } from "../iterm";
import type { SessionStore } from "../state";

const logger = streamDeck.logger.createScope("Dial");

// Use built-in layout $A0: icon + title + value
const LAYOUT_PATH = "layouts/session-info.json";

// Map action context -> currently selected slot
const dialSelectedSlot = new Map<string, number>();
// Track whether we've set the layout for a context
const layoutInitialized = new Set<string>();

let storeRef: SessionStore | undefined;

const projectTail2 = (project: string | undefined): string => {
  if (!project) return "";
  const parts = project.replace(/\/$/, "").split("/");
  return parts.slice(-2).join("/");
};

const ellipsis = (str: string, maxLen: number): string =>
  str.length > maxLen ? str.slice(0, maxLen - 1) + "\u2026" : str;

// Split prompt into two lines at word boundary
const splitPrompt = (prompt: string | undefined): [string, string] => {
  if (!prompt) return ["", ""];
  const normalized = prompt.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return ["", ""];

  const maxLine = 28;

  if (normalized.length <= maxLine) return [normalized, ""];

  let splitAt = maxLine;
  const spaceIdx = normalized.lastIndexOf(" ", maxLine);
  if (spaceIdx > maxLine / 2) {
    splitAt = spaceIdx;
  }

  const line1 = normalized.slice(0, splitAt).trim();
  const line2 = normalized.slice(splitAt).trim();
  return [ellipsis(line1, maxLine), ellipsis(line2, maxLine)];
};

const wrapSlot = (n: number): number => {
  if (n < MIN_SLOT) return MAX_SLOT;
  if (n > MAX_SLOT) return MIN_SLOT;
  return n;
};

// Generate a tiny solid-color PNG for the dial background pixmap
const solidColorPng = (hex: string, width: number, height: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRow = Buffer.alloc(1 + width * 3);
  rawRow[0] = 0;
  for (let x = 0; x < width; x++) {
    rawRow[1 + x * 3] = r;
    rawRow[2 + x * 3] = g;
    rawRow[3 + x * 3] = b;
  }

  const rawData = Buffer.alloc(rawRow.length * height);
  for (let y = 0; y < height; y++) {
    rawRow.copy(rawData, y * rawRow.length);
  }

  // deflate stored block
  const dataLen = rawData.length;
  const deflated = Buffer.alloc(5 + dataLen);
  deflated[0] = 0x01;
  deflated.writeUInt16LE(dataLen, 1);
  deflated.writeUInt16LE(dataLen ^ 0xffff, 3);
  rawData.copy(deflated, 5);

  // zlib wrapper
  const zlibData = Buffer.alloc(2 + deflated.length + 4);
  zlibData[0] = 0x78;
  zlibData[1] = 0x01;
  deflated.copy(zlibData, 2);
  let a = 1;
  let bv = 0;
  for (let i = 0; i < rawData.length; i++) {
    a = (a + rawData[i]!) % 65521;
    bv = (bv + a) % 65521;
  }
  zlibData.writeUInt32BE(((bv << 16) | a) >>> 0, 2 + deflated.length);

  const pngChunks: Buffer[] = [];
  pngChunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const writeChunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type, "ascii");
    const crcInput = Buffer.concat([typeB, data]);
    let crc = 0xffffffff;
    for (let i = 0; i < crcInput.length; i++) {
      crc = (crc32Table[(crc ^ crcInput[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc);
    pngChunks.push(len, typeB, data, crcB);
  };

  writeChunk("IHDR", ihdr);
  writeChunk("IDAT", zlibData);
  writeChunk("IEND", Buffer.alloc(0));

  return `data:image/png;base64,${Buffer.concat(pngChunks).toString("base64")}`;
};

const crc32Table: number[] = [];
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crc32Table.push(c >>> 0);
}

const buildFeedback = (slot: number, info: SessionInfo): FeedbackPayload => {
  const color = STATE_COLORS[info.state];
  const bgDataUrl = solidColorPng(color, 2, 1);
  const projLabel = ellipsis(projectTail2(info.project), 28);
  const [promptLine1, promptLine2] = splitPrompt(info.prompt);

  return {
    bg: bgDataUrl,
    line1: `${slot}: ${STATE_LABELS[info.state]}`,
    line2: projLabel,
    line3: promptLine1,
    line4: promptLine2,
  };
};

@action({ UUID: "com.keiya.claude-status.session-dial" })
export class ClaudeSessionDial extends SingletonAction<ActionSettings> {
  static setStore(store: SessionStore): void {
    storeRef = store;
  }

  override async onWillAppear(ev: WillAppearEvent<ActionSettings>): Promise<void> {
    const slot = parseSlot(ev.payload.settings.slot);
    dialSelectedSlot.set(ev.action.id, slot);
    logger.info(`Slot ${slot}: dial appeared`);

    if (storeRef && ev.action.isDial()) {
      try {
        // Explicitly set the custom layout first
        if (!layoutInitialized.has(ev.action.id)) {
          await ev.action.setFeedbackLayout(LAYOUT_PATH);
          layoutInitialized.add(ev.action.id);
          logger.info(`Slot ${slot}: layout set to ${LAYOUT_PATH}`);
        }
        const info = storeRef.get(slot);
        const fb = buildFeedback(slot, info);
        await ev.action.setFeedback(fb);
        logger.info(`Slot ${slot}: dial rendered (${info.state})`);
      } catch (e) {
        if (e instanceof Error) logger.error(`Slot ${slot}: dial render failed: ${e.message}`);
      }
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActionSettings>): Promise<void> {
    const slot = parseSlot(ev.payload.settings.slot);
    dialSelectedSlot.set(ev.action.id, slot);
    logger.info(`Slot ${slot}: dial settings changed`);

    if (storeRef && ev.action.isDial()) {
      try {
        await ev.action.setFeedbackLayout(LAYOUT_PATH);
        const info = storeRef.get(slot);
        await ev.action.setFeedback(buildFeedback(slot, info));
        logger.info(`Slot ${slot}: dial rendered (${info.state})`);
      } catch (e) {
        if (e instanceof Error) logger.error(`Slot ${slot}: dial render failed: ${e.message}`);
      }
    }
  }

  override async onDialRotate(ev: DialRotateEvent<ActionSettings>): Promise<void> {
    const currentSlot = dialSelectedSlot.get(ev.action.id) ?? 1;
    const direction = ev.payload.ticks > 0 ? 1 : -1;
    const newSlot = wrapSlot(currentSlot + direction);
    dialSelectedSlot.set(ev.action.id, newSlot);
    logger.info(`Dial rotated: slot ${currentSlot} -> ${newSlot}`);

    if (storeRef) {
      const info = storeRef.get(newSlot);
      try {
        await ev.action.setFeedback(buildFeedback(newSlot, info));
      } catch (e) {
        if (e instanceof Error) logger.error(`Slot ${newSlot}: dial render failed: ${e.message}`);
      }
    }
  }

  override async onDialDown(ev: DialDownEvent<ActionSettings>): Promise<void> {
    const slot = dialSelectedSlot.get(ev.action.id) ?? 1;
    logger.info(`Slot ${slot}: dial pressed`);

    // Acknowledge: reset done/idle to offline (read → unread style)
    if (storeRef) {
      const current = storeRef.get(slot);
      if (current.state === "done" || current.state === "idle") {
        storeRef.update({ slot, state: "offline" });
        logger.info(`Slot ${slot}: acknowledged (${current.state} -> offline)`);
      }
    }

    await switchToTab(slot);
  }

  static updateSlot(slot: number, info: SessionInfo): void {
    logger.info(`Slot ${slot}: dial updateSlot called, contexts=${dialSelectedSlot.size}`);
    const feedback = buildFeedback(slot, info);
    for (const [context, s] of dialSelectedSlot) {
      if (s === slot) {
        const actionObj = streamDeck.actions.getActionById(context);
        logger.info(`Slot ${slot}: context=${context}, isDial=${actionObj?.isDial()}`);
        if (actionObj?.isDial()) {
          void actionObj.setFeedback(feedback).then(() => {
            logger.info(`Slot ${slot}: dial feedback sent`);
          }).catch((e) => {
            if (e instanceof Error) logger.error(`Slot ${slot}: dial feedback failed: ${e.message}`);
          });
        }
      }
    }
  }
}
