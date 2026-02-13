import type { SessionInfo } from "./types";
import { STATE_COLORS } from "./types";

// Minimal solid-color background SVG for button (no text — use setTitle instead)
export const generateButtonSvg = (_slot: number, info: SessionInfo): string => {
  const color = STATE_COLORS[info.state];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="12" fill="${color}"/></svg>`;
};

export const svgToDataUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;

// Solid-color pixmap SVG for LCD dial background
export const generateDialBgSvg = (color: string, width: number, height: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`;

// Project path tail (last N segments)
export const projectTail = (project: string | undefined, segments: number): string => {
  if (!project) return "";
  const parts = project.replace(/\/$/, "").split("/");
  return parts.slice(-segments).join("/");
};
