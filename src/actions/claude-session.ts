import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type { ActionSettings, SessionInfo } from "../types";
import { parseSlot, STATE_LABELS, STATE_COLORS } from "../types";
import { projectTail } from "../svg";
import { switchToTab } from "../iterm";
import type { SessionStore } from "../state";

const logger = streamDeck.logger.createScope("Session");

// Map action context -> slot
const contextSlot = new Map<string, number>();

let storeRef: SessionStore | undefined;

// Generate a tiny 8x8 solid-color PNG data URL (no external libs needed)
const solidColorPng = (hex: string): string => {
  // Parse hex color
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Build minimal PNG: 8x8 pixels, RGBA, uncompressed (stored blocks)
  const width = 8;
  const height = 8;

  // IHDR data (13 bytes)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image data: filter byte (0) + RGB for each pixel, per row
  const rawRow = Buffer.alloc(1 + width * 3);
  rawRow[0] = 0; // no filter
  for (let x = 0; x < width; x++) {
    rawRow[1 + x * 3] = r;
    rawRow[2 + x * 3] = g;
    rawRow[3 + x * 3] = b;
  }

  // All rows
  const rawData = Buffer.alloc(rawRow.length * height);
  for (let y = 0; y < height; y++) {
    rawRow.copy(rawData, y * rawRow.length);
  }

  // Deflate stored block (no compression):
  // 1 byte: 0x01 (final block, stored)
  // 2 bytes: length (little endian)
  // 2 bytes: ~length (little endian)
  // data
  const dataLen = rawData.length;
  const deflated = Buffer.alloc(5 + dataLen);
  deflated[0] = 0x01;
  deflated.writeUInt16LE(dataLen, 1);
  deflated.writeUInt16LE(dataLen ^ 0xffff, 3);
  rawData.copy(deflated, 5);

  // zlib wrapper: CMF + FLG + deflated + adler32
  const cmf = 0x78;
  const flg = 0x01;
  // Adler-32 of rawData
  let a = 1;
  let bv = 0;
  for (let i = 0; i < rawData.length; i++) {
    a = (a + rawData[i]!) % 65521;
    bv = (bv + a) % 65521;
  }
  const adler = ((bv << 16) | a) >>> 0;

  const zlibData = Buffer.alloc(2 + deflated.length + 4);
  zlibData[0] = cmf;
  zlibData[1] = flg;
  deflated.copy(zlibData, 2);
  zlibData.writeUInt32BE(adler, 2 + deflated.length);

  // Build PNG chunks
  const pngChunks: Buffer[] = [];

  // PNG signature
  pngChunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const writeChunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type, "ascii");
    const crcInput = Buffer.concat([typeB, data]);
    const crc = crc32(crcInput);
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc);
    pngChunks.push(len, typeB, data, crcB);
  };

  writeChunk("IHDR", ihdr);
  writeChunk("IDAT", zlibData);
  writeChunk("IEND", Buffer.alloc(0));

  const png = Buffer.concat(pngChunks);
  return `data:image/png;base64,${png.toString("base64")}`;
};

// CRC-32 for PNG chunks
const crc32Table: number[] = [];
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crc32Table.push(c >>> 0);
}
const crc32 = (buf: Buffer): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc32Table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const renderButton = async (
  actionObj: { setImage: (image: string) => Promise<void>; setTitle: (title: string) => Promise<void> },
  slot: number,
  info: SessionInfo,
): Promise<void> => {
  const color = STATE_COLORS[info.state];
  const dataUrl = solidColorPng(color);
  const proj = projectTail(info.project, 1);
  const title = proj ? `${slot}\n${proj}` : `${slot}\n${STATE_LABELS[info.state]}`;

  try {
    await actionObj.setImage(dataUrl);
    await actionObj.setTitle(title);
    logger.info(`Slot ${slot}: rendered (${info.state})`);
  } catch (e) {
    if (e instanceof Error) logger.error(`Slot ${slot}: render failed: ${e.message}`);
  }
};

@action({ UUID: "com.keiya.claude-status.session" })
export class ClaudeSession extends SingletonAction<ActionSettings> {
  static setStore(store: SessionStore): void {
    storeRef = store;
  }

  override async onWillAppear(ev: WillAppearEvent<ActionSettings>): Promise<void> {
    const slot = parseSlot(ev.payload.settings.slot);
    contextSlot.set(ev.action.id, slot);
    logger.info(`Slot ${slot}: button appeared`);

    if (storeRef) {
      const info = storeRef.get(slot);
      await renderButton(ev.action, slot, info);
    }
  }

  override onWillDisappear(ev: WillDisappearEvent<ActionSettings>): void {
    contextSlot.delete(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActionSettings>): Promise<void> {
    const slot = parseSlot(ev.payload.settings.slot);
    contextSlot.set(ev.action.id, slot);
    logger.info(`Slot ${slot}: button settings changed`);

    if (storeRef) {
      const info = storeRef.get(slot);
      await renderButton(ev.action, slot, info);
    }
  }

  override async onKeyDown(ev: KeyDownEvent<ActionSettings>): Promise<void> {
    const slot = parseSlot(ev.payload.settings.slot);
    logger.info(`Slot ${slot}: button pressed`);

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
    logger.info(`Slot ${slot}: updateSlot called, contexts=${contextSlot.size}`);
    for (const [context, s] of contextSlot) {
      if (s === slot) {
        logger.info(`Slot ${slot}: found context ${context}, rendering`);
        const actionObj = streamDeck.actions.getActionById(context);
        if (actionObj) {
          void renderButton(actionObj, slot, info);
        } else {
          logger.warn(`Slot ${slot}: action not found for context ${context}`);
        }
      }
    }
  }
}
