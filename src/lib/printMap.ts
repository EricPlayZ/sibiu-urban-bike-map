import type { Map } from "maplibre-gl";
import { getActiveMap } from "./activeMap";
import { metersPerPixel } from "./glowRibbon";
import type { BasemapId } from "./space";
import { useApp } from "../store";
import {
  boundsCenter,
  ellipsize,
  legendBlock,
  mapPixelRatio,
  niceScale,
  pageMm,
  pagePixels,
  paperFrameMm,
  posterLayout,
  printAttribution,
  printLegendRows,
  printStrokeScale,
  printViewport,
  zoomForPaperScale,
  type Box,
  type Orientation,
  type PaperId,
  type PrintDpi,
  type PrintFrame,
  type PrintLegendRow,
  type PrintPadding,
  type PrintSwatch,
  type ScaleCenter,
} from "./printLayout";

export class PrintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintError";
  }
}

export type MapPrintRequest = {
  paper: PaperId;
  orientation: Orientation;
  dpi: PrintDpi;
  basemap: BasemapId;
  legend: { layers: PrintSwatch[]; schools: PrintSwatch[] };
  frame: PrintFrame;
  scale?: number;
  scaleCenter?: ScaleCenter;
  /** Lng/lat used when `scaleCenter` is `custom`. */
  customCenter?: [number, number] | null;
  /** South-west / north-east of the city. */
  bounds?: [[number, number], [number, number]] | null;
  /** When set, the sheet is rasterized so its long side stays under this many pixels. */
  previewEdge?: number;
};

const INK = "#132019";
const MUTED = "#5c6b63";

let renderTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = renderTail.then(job, job);
  renderTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export type MapPreview = {
  url: string;
  center: [number, number];
  zoom: number;
  metersPerPosterPx: number;
  page: { w: number; h: number };
  map: Box;
  /** North-west and south-east of the printed map, in the capture camera. */
  nw: [number, number];
  se: [number, number];
};

export function previewMapSheet(req: MapPrintRequest) {
  return enqueue(async () => {
    const rendered = await renderPoster({ ...req, previewEdge: req.previewEdge ?? 1500 });
    try {
      return { ...rendered.meta, url: rendered.canvas.toDataURL("image/jpeg", 0.8) };
    } catch (err) {
      if (isSecurityError(err)) {
        throw new PrintError("Browserul nu lasă citirea hărții pentru PDF. Încearcă fundalul Deschis sau Întunecat.");
      }
      throw err;
    }
  });
}

export async function downloadMapPdf(req: MapPrintRequest) {
  try {
    const rendered = await enqueue(() => renderPoster(req));
    let jpeg: string;
    try {
      jpeg = rendered.canvas.toDataURL("image/jpeg", 0.93);
    } catch (err) {
      if (isSecurityError(err)) {
        throw new PrintError("Browserul nu lasă citirea hărții pentru PDF. Încearcă fundalul Deschis sau Întunecat.");
      }
      throw err;
    }
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({
      orientation: req.orientation,
      unit: "mm",
      format: req.paper,
      compress: true,
    });
    const mm = pageMm(req.paper, req.orientation);
    doc.setProperties({
      title: "Map the City — Sibiu",
      subject: "Hartă pentru tipar",
      creator: "Map the City",
    });
    doc.addImage(jpeg, "JPEG", 0, 0, mm.w, mm.h);
    const facing = req.orientation === "landscape" ? "peisaj" : "portret";
    doc.save(`sibiu-harta-${req.paper}-${facing}.pdf`);
  } catch (err) {
    if (err instanceof PrintError) throw err;
    console.error(err);
    throw new PrintError("Nu am putut genera PDF-ul.");
  }
}

async function renderPoster(req: MapPrintRequest) {
  const map = getActiveMap();
  if (!map) throw new PrintError("Harta nu e gata.");
  const restoreBasemap = await holdPrintBasemap(map, req.basemap);
  try {
    return await renderPosterView(map, req);
  } finally {
    await restoreBasemap();
  }
}

async function renderPosterView(map: Map, req: MapPrintRequest) {
  if (!map.isStyleLoaded()) throw new PrintError("Harta nu e gata.");
  const cssW = map.getContainer().clientWidth;
  const cssH = map.getContainer().clientHeight;
  if (cssW < 2 || cssH < 2) throw new PrintError("Harta nu e gata.");

  const pageDpi = req.previewEdge ? dpiForEdge(req.paper, req.orientation, req.previewEdge) : req.dpi;
  const page = pagePixels(req.paper, req.orientation, pageDpi);
  const layout = posterLayout(page.w, page.h, pageDpi);
  const viewport = printViewport(cssW, cssH, layout.map.w, layout.map.h);
  const ratio = mapPixelRatio(cssW, cssH, viewport.crop.w, viewport.crop.h, layout.map.w, layout.map.h, map.getPixelRatio());
  const frame = paperFrameMm(req.paper, req.orientation);

  const here = map.getCenter();
  const camera = {
    center: [here.lng, here.lat] as [number, number],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
  const moved = req.frame !== "view";
  try {
    if (req.frame === "city") {
      if (!req.bounds) throw new PrintError("Nu am geometria orașului.");
      await showCity(map, req.bounds, viewport.padding);
    } else if (req.frame === "scale") {
      const scale = req.scale;
      if (!scale) throw new PrintError("Alege o scară.");
      if (req.scaleCenter === "city" && !req.bounds) throw new PrintError("Nu am geometria orașului.");
      const at =
        req.scaleCenter === "city" && req.bounds
          ? boundsCenter(req.bounds)
          : req.scaleCenter === "custom" && req.customCenter
            ? req.customCenter
            : camera.center;
      await showScale(map, scale, at, viewport.padding, frame.w);
    }
    const view = {
      lat: map.getCenter().lat,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      cssW,
      cssH,
      crop: viewport.crop,
    };
    const undoStrokes = applyPrintStrokes(map, printStrokeScale(viewport.crop.w, frame.w));
    try {
      map.redraw();
      const snap = captureMap(map, ratio);
      await loadPrintFonts();
      const canvas = composePoster(req, page, layout, snap, view);
      const at = map.getCenter();
      const nw = map.unproject([view.crop.x, view.crop.y]);
      const se = map.unproject([view.crop.x + view.crop.w, view.crop.y + view.crop.h]);
      return {
        canvas,
        meta: {
          center: [at.lng, at.lat] as [number, number],
          zoom: view.zoom,
          metersPerPosterPx: metersPerPixel(view.lat, view.zoom) * (view.crop.w / layout.map.w),
          page: { w: page.w, h: page.h },
          map: layout.map,
          nw: [nw.lng, nw.lat] as [number, number],
          se: [se.lng, se.lat] as [number, number],
        },
      };
    } finally {
      undoStrokes();
    }
  } finally {
    if (moved) {
      map.jumpTo(camera);
      map.redraw();
    }
  }
}

function onceStyleLoad(map: Map, ms = 20000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      map.off("style.load", onLoad);
      reject(new PrintError("Harta nu a terminat de încărcat. Încearcă din nou."));
    }, ms);
    const onLoad = () => {
      window.clearTimeout(timer);
      resolve();
    };
    map.once("style.load", onLoad);
  });
}

async function waitForLayer(map: Map, id: string) {
  const deadline = performance.now() + 20000;
  while (performance.now() < deadline) {
    if (map.isStyleLoaded() && map.getLayer(id)) return;
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
  throw new PrintError("Harta nu a terminat de încărcat. Încearcă din nou.");
}

/** Switch the live basemap for the capture, then put the previous one back. */
async function holdPrintBasemap(map: Map, next: BasemapId) {
  const previous = useApp.getState().basemap;
  if (previous === next) return async () => {};
  const restore = async () => {
    if (useApp.getState().basemap === previous) return;
    const back = onceStyleLoad(map);
    useApp.getState().setBasemap(previous);
    await back;
    await waitForLayer(map, "streets-base");
  };
  try {
    const loaded = onceStyleLoad(map);
    useApp.getState().setBasemap(next);
    await loaded;
    await waitForLayer(map, "streets-base");
    if (!(map.loaded() && !map.isMoving())) {
      const pending = whenIdle(map);
      map.triggerRepaint();
      await pending;
    }
  } catch (err) {
    await restore().catch(() => undefined);
    throw err;
  }
  return restore;
}

function dpiForEdge(paper: PaperId, orientation: Orientation, maxEdge: number) {
  const mm = pageMm(paper, orientation);
  const longMm = Math.max(mm.w, mm.h);
  return Math.max(20, Math.min(72, Math.floor(maxEdge / (longMm / 25.4))));
}

function composePoster(
  req: MapPrintRequest,
  page: { w: number; h: number },
  layout: ReturnType<typeof posterLayout>,
  snap: HTMLCanvasElement,
  view: { lat: number; zoom: number; bearing: number; cssW: number; cssH: number; crop: Box },
) {
  const rows = printLegendRows(req.legend.layers, req.legend.schools);
  const poster = document.createElement("canvas");
  poster.width = page.w;
  poster.height = page.h;
  const ctx = poster.getContext("2d");
  if (!ctx) throw new PrintError("Nu am putut genera PDF-ul.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, poster.width, poster.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const scaleX = snap.width / view.cssW;
  const scaleY = snap.height / view.cssH;
  ctx.drawImage(
    snap,
    view.crop.x * scaleX,
    view.crop.y * scaleY,
    view.crop.w * scaleX,
    view.crop.h * scaleY,
    layout.map.x,
    layout.map.y,
    layout.map.w,
    layout.map.h,
  );

  const metersPerPosterPx = metersPerPixel(view.lat, view.zoom) * (view.crop.w / layout.map.w);
  drawScaleBar(ctx, layout.map, metersPerPosterPx);
  drawNorth(ctx, layout.map, view.bearing);
  drawTitle(ctx, layout.map, req);
  if (rows.length) drawLegendPanel(ctx, layout.map, rows);
  drawAttribution(ctx, layout.map, req.basemap);
  return poster;
}

function showCity(map: Map, bounds: [[number, number], [number, number]], padding: PrintPadding) {
  const inset = 24;
  const camera = map.cameraForBounds(bounds, {
    padding: {
      left: padding.left + inset,
      right: padding.right + inset,
      top: padding.top + inset,
      bottom: padding.bottom + inset,
    },
    bearing: 0,
    pitch: 0,
    maxZoom: 17,
  });
  if (!camera) throw new PrintError("Nu am putut încadra orașul.");
  map.stop();
  const pending = whenIdle(map);
  map.jumpTo(camera);
  return pending;
}

function showScale(
  map: Map,
  scale: number,
  center: [number, number],
  padding: PrintPadding,
  frameWmm: number,
) {
  const cropW = Math.max(1, map.getContainer().clientWidth - padding.left - padding.right);
  const zoom = zoomForPaperScale(center[1], scale, cropW, frameWmm);
  map.stop();
  const pending = whenIdle(map);
  map.jumpTo({
    center,
    zoom: Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), zoom)),
    bearing: 0,
    pitch: 0,
  });
  return pending;
}

const PRINT_PAINT: Record<string, string[]> = {
  line: ["line-width", "line-offset", "line-blur", "line-gap-width"],
  circle: ["circle-radius", "circle-stroke-width"],
};

const PRINT_LAYOUT: Record<string, string[]> = {
  symbol: ["text-size", "icon-size"],
};

function applyPrintStrokes(map: Map, factor: number) {
  if (!(factor > 0) || Math.abs(factor - 1) < 0.02) return () => {};
  const saved: { id: string; kind: "paint" | "layout"; prop: string; value: unknown }[] = [];
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    const paintProps = PRINT_PAINT[layer.type];
    if (paintProps) {
      for (const prop of paintProps) savePaint(map, saved, layer.id, prop, factor);
    }
    const layoutProps = PRINT_LAYOUT[layer.type];
    if (layoutProps) {
      for (const prop of layoutProps) saveLayout(map, saved, layer.id, prop, factor);
    }
  }
  return () => {
    for (const item of saved) {
      try {
        if (item.kind === "paint") map.setPaintProperty(item.id, item.prop, item.value);
        else map.setLayoutProperty(item.id, item.prop, item.value);
      } catch {
        /* layer gone */
      }
    }
  };
}

function savePaint(
  map: Map,
  saved: { id: string; kind: "paint" | "layout"; prop: string; value: unknown }[],
  id: string,
  prop: string,
  factor: number,
) {
  let value: unknown;
  try {
    value = map.getPaintProperty(id, prop);
  } catch {
    return;
  }
  if (value == null) return;
  saved.push({ id, kind: "paint", prop, value });
  try {
    map.setPaintProperty(id, prop, scaleStyleValue(value, factor));
  } catch {
    saved.pop();
  }
}

function saveLayout(
  map: Map,
  saved: { id: string; kind: "paint" | "layout"; prop: string; value: unknown }[],
  id: string,
  prop: string,
  factor: number,
) {
  let value: unknown;
  try {
    value = map.getLayoutProperty(id, prop);
  } catch {
    return;
  }
  if (value == null) return;
  saved.push({ id, kind: "layout", prop, value });
  try {
    map.setLayoutProperty(id, prop, scaleStyleValue(value, factor));
  } catch {
    saved.pop();
  }
}

function scaleStyleValue(value: unknown, factor: number) {
  if (typeof value === "number") return value * factor;
  if (Array.isArray(value)) return ["*", value, factor];
  return value;
}

function whenIdle(map: Map, ms = 20000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      map.off("idle", onIdle);
      reject(new PrintError("Harta nu a terminat de încărcat. Încearcă din nou."));
    }, ms);
    const onIdle = () => {
      window.clearTimeout(timer);
      resolve();
    };
    map.once("idle", onIdle);
  });
}

function captureMap(map: Map, ratio: number) {
  map.stop();
  const changed = Math.abs(map.getPixelRatio() - ratio) > 0.01;
  if (changed) map.setPixelRatio(ratio);
  try {
    map.redraw();
    return copyCanvas(map.getCanvas());
  } finally {
    if (changed) {
      map.setPixelRatio(null as unknown as number);
      map.redraw();
    }
  }
}

function copyCanvas(src: HTMLCanvasElement) {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d");
  if (!ctx || out.width < 2 || out.height < 2) throw new PrintError("Nu am putut citi harta.");
  ctx.drawImage(src, 0, 0);
  return out;
}

async function loadPrintFonts() {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load("700 48px Manrope"),
    document.fonts.load("600 32px Manrope"),
    document.fonts.load("500 24px Manrope"),
  ]).catch(() => undefined);
}

function drawTitle(ctx: CanvasRenderingContext2D, mapBox: Box, req: MapPrintRequest) {
  const pad = Math.round(Math.min(mapBox.w, mapBox.h) * 0.02);
  const titlePx = Math.max(16, Math.min(64, Math.round(mapBox.h * 0.028)));
  const subPx = Math.max(12, Math.round(titlePx * 0.5));
  const facing = req.orientation === "landscape" ? "peisaj" : "portret";
  const sub = `Sibiu · ${req.paper.toUpperCase()} ${facing}`;
  ctx.font = `700 ${titlePx}px Manrope, sans-serif`;
  const titleW = ctx.measureText("Map the City").width;
  ctx.font = `500 ${subPx}px Manrope, sans-serif`;
  const subW = ctx.measureText(sub).width;
  const boxW = Math.max(titleW, subW) + titlePx;
  const boxH = titlePx + subPx + titlePx * 0.7;
  const x = mapBox.x + pad;
  const y = mapBox.y + pad;
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  roundRect(ctx, x, y, boxW, boxH, 8);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = INK;
  ctx.font = `700 ${titlePx}px Manrope, sans-serif`;
  ctx.fillText("Map the City", x + titlePx * 0.45, y + titlePx * 0.28);
  ctx.fillStyle = MUTED;
  ctx.font = `500 ${subPx}px Manrope, sans-serif`;
  ctx.fillText(sub, x + titlePx * 0.45, y + titlePx * 0.4 + titlePx);
}

function drawAttribution(ctx: CanvasRenderingContext2D, mapBox: Box, basemap: BasemapId) {
  const pad = Math.round(Math.min(mapBox.w, mapBox.h) * 0.02);
  const fontPx = Math.max(11, Math.min(22, Math.round(mapBox.h * 0.014)));
  const date = new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const text = `${date} · ${printAttribution(basemap)}`;
  ctx.font = `500 ${fontPx}px Manrope, sans-serif`;
  const textW = ctx.measureText(text).width;
  const x = mapBox.x + (mapBox.w - textW) / 2;
  const y = mapBox.y + mapBox.h - pad - fontPx;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  roundRect(ctx, x - fontPx * 0.4, y - fontPx * 0.25, textW + fontPx * 0.8, fontPx * 1.5, 6);
  ctx.fill();
  ctx.fillStyle = MUTED;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

function drawScaleBar(ctx: CanvasRenderingContext2D, mapBox: Box, metersPerPosterPx: number) {
  const pad = Math.round(Math.min(mapBox.w, mapBox.h) * 0.028);
  const scale = niceScale(metersPerPosterPx, Math.max(48, mapBox.w * 0.26));
  if (!scale.meters) return;
  const fontPx = Math.max(12, Math.round(Math.min(mapBox.w, mapBox.h) * 0.02));
  ctx.font = `600 ${fontPx}px Manrope, sans-serif`;
  const labelW = ctx.measureText(scale.label).width;
  const barW = Math.max(scale.px, labelW);
  const blockH = fontPx + 16;
  const x = mapBox.x + pad;
  const y = mapBox.y + mapBox.h - pad - blockH;
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  roundRect(ctx, x - 8, y - 6, barW + 16, blockH + 8, 6);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(scale.label, x, y);
  const lineY = y + fontPx + 8;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, fontPx * 0.08);
  ctx.beginPath();
  ctx.moveTo(x, lineY);
  ctx.lineTo(x + scale.px, lineY);
  ctx.moveTo(x, lineY - 4);
  ctx.lineTo(x, lineY + 4);
  ctx.moveTo(x + scale.px, lineY - 4);
  ctx.lineTo(x + scale.px, lineY + 4);
  ctx.stroke();
}

function drawNorth(ctx: CanvasRenderingContext2D, mapBox: Box, bearing: number) {
  const size = Math.max(28, Math.min(96, Math.round(Math.min(mapBox.w, mapBox.h) * 0.045)));
  const pad = Math.round(Math.min(mapBox.w, mapBox.h) * 0.02);
  const cx = mapBox.x + mapBox.w - pad - size * 0.5;
  const cy = mapBox.y + mapBox.h - pad - size * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate((-bearing * Math.PI) / 180);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.32);
  ctx.lineTo(size * 0.12, size * 0.18);
  ctx.lineTo(0, size * 0.06);
  ctx.lineTo(-size * 0.12, size * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.translate(0, -size * 0.34);
  ctx.rotate((bearing * Math.PI) / 180);
  ctx.font = `700 ${Math.round(size * 0.26)}px Manrope, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", 0, 0);
  ctx.restore();
}

function drawLegendPanel(ctx: CanvasRenderingContext2D, mapBox: Box, rows: PrintLegendRow[]) {
  const inset = Math.round(Math.min(mapBox.w, mapBox.h) * 0.02);
  const fontPx = Math.max(11, Math.min(22, Math.round(mapBox.h * 0.016)));
  ctx.font = `600 ${fontPx}px Manrope, sans-serif`;
  let labelPx = 0;
  for (const row of rows) labelPx = Math.max(labelPx, ctx.measureText(row.label).width);
  const block = legendBlock(rows.length, fontPx, labelPx, mapBox.w * 0.42, mapBox.h * 0.7);
  const box: Box = {
    x: mapBox.x + mapBox.w - inset - block.w,
    y: mapBox.y + inset,
    w: block.w,
    h: block.h,
  };
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  roundRect(ctx, box.x, box.y, box.w, box.h, 8);
  ctx.fill();
  drawLegend(ctx, box, rows, fontPx, block.pad, block.lineH, block.cols);
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  box: Box,
  rows: PrintLegendRow[],
  fontPx: number,
  pad: number,
  lineH: number,
  cols: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();

  const perCol = Math.max(1, Math.ceil(rows.length / cols));
  const colW = (box.w - pad * 2) / cols;
  const swatch = Math.max(6, fontPx * 0.45);

  const widthOf = (text: string) => {
    ctx.font = `600 ${fontPx}px Manrope, sans-serif`;
    return ctx.measureText(text).width;
  };

  rows.forEach((row, index) => {
    const col = Math.floor(index / perCol);
    const rowIndex = index % perCol;
    const x = box.x + pad + col * colW;
    const y = box.y + pad + rowIndex * lineH;
    if (row.kind === "kicker") {
      ctx.fillStyle = MUTED;
      ctx.font = `700 ${Math.max(10, Math.round(fontPx * 0.82))}px Manrope, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(row.label, x, y + (lineH - fontPx) / 2);
      return;
    }
    ctx.fillStyle = row.color;
    ctx.beginPath();
    ctx.arc(x + swatch / 2, y + lineH * 0.42, swatch / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = `600 ${fontPx}px Manrope, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const maxW = Math.max(8, colW - swatch - fontPx * 0.6);
    ctx.fillText(ellipsize(row.label, maxW, widthOf), x + swatch + fontPx * 0.4, y + lineH * 0.42);
  });
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function isSecurityError(err: unknown) {
  return err instanceof DOMException && err.name === "SecurityError";
}
