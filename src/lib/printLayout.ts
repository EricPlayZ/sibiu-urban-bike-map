import type { BasemapId } from "./space";

export const PAPER_IDS = ["a4", "a3", "a2", "a1", "a0"] as const;
export type PaperId = (typeof PAPER_IDS)[number];
export type Orientation = "landscape" | "portrait";
export type PrintFrame = "view" | "city" | "scale";
export type ScaleCenter = "screen" | "city" | "custom";
export const PRINT_SCALES = [2500, 5000, 10000, 15000, 25000] as const;
export type PrintScale = (typeof PRINT_SCALES)[number];

/** 1 screen pixel of stroke should print about this wide, so A0 does not turn streets into blobs. */
export const PRINT_MM_PER_SCREEN_PX = 0.15;
export const PRINT_DPI = [150, 200] as const;
export type PrintDpi = (typeof PRINT_DPI)[number];

/** Above MapLibre's 4096 default so A1/A0 can stay sharp. The GPU may still clamp lower. */
export const MAX_MAP_BITMAP = 8192;

export const PRINT_MARGIN_MM = { left: 20, top: 5, right: 5, bottom: 5 } as const;

const PAPER_MM: Record<PaperId, { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  a3: { w: 297, h: 420 },
  a2: { w: 420, h: 594 },
  a1: { w: 594, h: 841 },
  a0: { w: 841, h: 1189 },
};

const SCALE_STEPS_M = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000];

export type Box = { x: number; y: number; w: number; h: number };

export type PrintSwatch = { label: string; color: string; off?: boolean };

export type PrintLegendRow =
  | { kind: "kicker"; label: string }
  | { kind: "item"; label: string; color: string };

export function pageMm(paper: PaperId, orientation: Orientation) {
  const size = PAPER_MM[paper];
  return orientation === "landscape" ? { w: size.h, h: size.w } : { w: size.w, h: size.h };
}

export function pagePixels(paper: PaperId, orientation: Orientation, dpi: number) {
  const mm = pageMm(paper, orientation);
  const px = (n: number) => Math.round((n / 25.4) * dpi);
  return { w: px(mm.w), h: px(mm.h), mm };
}

export function mmToPx(mm: number, dpi: number) {
  return Math.round((mm / 25.4) * dpi);
}

export function posterLayout(pageW: number, pageH: number, dpi: number) {
  const left = mmToPx(PRINT_MARGIN_MM.left, dpi);
  const top = mmToPx(PRINT_MARGIN_MM.top, dpi);
  const right = mmToPx(PRINT_MARGIN_MM.right, dpi);
  const bottom = mmToPx(PRINT_MARGIN_MM.bottom, dpi);
  return {
    map: {
      x: left,
      y: top,
      w: Math.max(1, pageW - left - right),
      h: Math.max(1, pageH - top - bottom),
    } satisfies Box,
  };
}

export type PrintPadding = { left: number; right: number; top: number; bottom: number };

/** Centered crop of the screen whose aspect matches the printable frame. */
export function printViewport(cssW: number, cssH: number, frameW: number, frameH: number) {
  const frameAspect = frameW > 0 && frameH > 0 ? frameW / frameH : 1;
  const screenAspect = cssH > 0 ? cssW / cssH : frameAspect;
  let cropW = cssW;
  let cropH = cssH;
  if (screenAspect > frameAspect) cropW = cssH * frameAspect;
  else cropH = cssW / frameAspect;
  cropW = Math.max(1, Math.min(cssW, cropW));
  cropH = Math.max(1, Math.min(cssH, cropH));
  const left = Math.max(0, (cssW - cropW) / 2);
  const top = Math.max(0, (cssH - cropH) / 2);
  return {
    crop: { x: left, y: top, w: cropW, h: cropH },
    padding: { left, right: left, top, bottom: top } satisfies PrintPadding,
  };
}

export function mapPixelRatio(
  cssW: number,
  cssH: number,
  cropW: number,
  cropH: number,
  targetW: number,
  targetH: number,
  deviceRatio: number,
) {
  if (cssW < 2 || cssH < 2 || cropW < 1 || cropH < 1 || cssW >= MAX_MAP_BITMAP || cssH >= MAX_MAP_BITMAP) return 1;
  const needed = Math.min(targetW / cropW, targetH / cropH);
  let ratio = Math.max(1, deviceRatio > 0 ? deviceRatio : 1, needed > 0 ? needed : 1);
  ratio = Math.min(ratio, MAX_MAP_BITMAP / cssW, MAX_MAP_BITMAP / cssH);
  return Math.max(1, Math.floor(ratio * 100) / 100);
}

export function paperFrameMm(paper: PaperId, orientation: Orientation) {
  const page = pageMm(paper, orientation);
  return {
    w: page.w - PRINT_MARGIN_MM.left - PRINT_MARGIN_MM.right,
    h: page.h - PRINT_MARGIN_MM.top - PRINT_MARGIN_MM.bottom,
  };
}

export function boundsSpanMeters(bounds: [[number, number], [number, number]]) {
  const [[west, south], [east, north]] = bounds;
  const midLat = (south + north) / 2;
  const height = Math.abs(north - south) * 111320;
  const width = Math.abs(east - west) * 111320 * Math.cos((midLat * Math.PI) / 180);
  return { width, height };
}

export function boundsCenter(bounds: [[number, number], [number, number]]): [number, number] {
  return [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
}

const METERS_PER_DEG = 111320;

/** Shift a lng/lat by ground meters. East and north are positive. */
export function panLngLat(center: [number, number], eastMeters: number, northMeters: number): [number, number] {
  const cos = Math.cos((center[1] * Math.PI) / 180);
  const lng = center[0] + eastMeters / (METERS_PER_DEG * Math.max(0.2, Math.abs(cos)));
  const lat = center[1] + northMeters / METERS_PER_DEG;
  return [lng, Math.max(-85, Math.min(85, lat))];
}

function lngLatToMercator(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360;
  const clamped = Math.max(-85, Math.min(85, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
}

function mercatorToLngLat(x: number, y: number): [number, number] {
  const lng = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lng, lat];
}

/** `fx`/`fy` are fractions of the printed map: 0,0 is the north-west corner, 1,1 the south-east. */
export function lngLatAtFrameFraction(
  nw: [number, number],
  se: [number, number],
  fx: number,
  fy: number,
): [number, number] {
  const a = lngLatToMercator(nw[0], nw[1]);
  const b = lngLatToMercator(se[0], se[1]);
  return mercatorToLngLat(a[0] + fx * (b[0] - a[0]), a[1] + fy * (b[1] - a[1]));
}

/** Smallest scale denominator that fits the bounds on the printable frame (1:N). */
export function minScaleForBounds(bounds: [[number, number], [number, number]], frameWmm: number, frameHmm: number) {
  const { width, height } = boundsSpanMeters(bounds);
  if (!(width > 0) || !(height > 0) || !(frameWmm > 0) || !(frameHmm > 0)) return null;
  return Math.max(width / (frameWmm / 1000), height / (frameHmm / 1000));
}

export function zoomForPaperScale(lat: number, scale: number, cropPx: number, frameMm: number) {
  const ground = scale * (frameMm / 1000);
  const mpp = ground / Math.max(cropPx, 1);
  const cos = Math.cos((lat * Math.PI) / 180);
  return Math.log2((156543.03392 * Math.max(0.01, cos)) / mpp);
}

export function printStrokeScale(cropPx: number, frameMm: number) {
  if (!(cropPx > 0) || !(frameMm > 0)) return 1;
  return Math.min(1, (PRINT_MM_PER_SCREEN_PX * cropPx) / frameMm);
}

export function formatScale(scale: number) {
  return `1:${Math.round(scale).toLocaleString("ro-RO")}`;
}

/** Accepts `8000`, `8.000`, or `1:10.000`. Denominators outside 100…500.000 are rejected. */
export function parseCustomScale(raw: string): number | null {
  let text = raw.trim().replace(/^1\s*:\s*/, "").replace(/\s/g, "");
  if (!text) return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  else text = text.replace(",", ".");
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  const scale = Math.round(value);
  if (scale < 100 || scale > 500000) return null;
  return scale;
}

export function legendBlock(rowCount: number, fontPx: number, labelPx: number, maxW: number, maxH: number) {
  const lineH = fontPx * 1.4;
  const pad = fontPx * 0.65;
  const colInner = fontPx * 1.25 + Math.max(0, labelPx);
  let cols = 1;
  const maxCols = Math.max(1, rowCount);
  while (cols < maxCols) {
    const rowsPer = Math.ceil(rowCount / cols);
    const height = pad * 2 + rowsPer * lineH;
    const width = pad * 2 + cols * colInner;
    if (height <= maxH && width <= maxW) break;
    if (width + colInner > maxW) break;
    cols += 1;
  }
  const rowsPer = Math.max(1, Math.ceil(rowCount / cols));
  return {
    cols,
    lineH,
    pad,
    w: Math.max(1, Math.min(maxW, pad * 2 + cols * colInner)),
    h: Math.max(1, Math.min(maxH, pad * 2 + rowsPer * lineH)),
  };
}

export function niceScale(metersPerPx: number, maxPx: number) {
  if (!(metersPerPx > 0) || !(maxPx > 0)) return { meters: 0, px: 0, label: "" };
  let chosen = SCALE_STEPS_M[0];
  for (const step of SCALE_STEPS_M) {
    if (step / metersPerPx <= maxPx) chosen = step;
    else break;
  }
  const px = chosen / metersPerPx;
  const label = chosen >= 1000 && chosen % 1000 === 0 ? `${chosen / 1000} km` : `${chosen} m`;
  return { meters: chosen, px, label };
}

export function printAttribution(basemap: BasemapId) {
  if (basemap === "satellite") return "© Esri, Maxar, Earthstar Geographics";
  return "© OpenStreetMap, © OpenFreeMap";
}

export function printLegendRows(layers: PrintSwatch[], schools: PrintSwatch[]): PrintLegendRow[] {
  const rows: PrintLegendRow[] = [];
  for (const item of layers) {
    if (!item.off) rows.push({ kind: "item", label: item.label, color: item.color });
  }
  const visibleSchools = schools.filter((item) => !item.off);
  if (visibleSchools.length) {
    rows.push({ kind: "kicker", label: "Școli" });
    for (const item of visibleSchools) rows.push({ kind: "item", label: item.label, color: item.color });
  }
  return rows;
}

export function featureCollectionBounds(
  collections: Array<{ features?: GeoJSON.Feature[] } | null | undefined>,
): [[number, number], [number, number]] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let any = false;
  const extend = (lng: number, lat: number) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    any = true;
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  };
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords) || !coords.length) return;
    if (typeof coords[0] === "number") {
      extend(Number(coords[0]), Number(coords[1]));
      return;
    }
    for (const child of coords) walk(child);
  };
  for (const collection of collections) {
    for (const feature of collection?.features || []) {
      const geometry = feature.geometry;
      if (!geometry || geometry.type === "GeometryCollection") continue;
      walk(geometry.coordinates);
    }
  }
  return any ? [[west, south], [east, north]] : null;
}

export function ellipsize(text: string, maxWidth: number, measure: (value: string) => number) {
  if (maxWidth <= 0) return "";
  if (measure(text) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && measure(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
  return cut.length < text.length ? `${cut}…` : text;
}
