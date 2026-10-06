import { describe, expect, it } from "vitest";
import {
  ellipsize,
  featureCollectionBounds,
  legendBlock,
  mapPixelRatio,
  minScaleForBounds,
  mmToPx,
  lngLatAtFrameFraction,
  niceScale,
  panLngLat,
  pageMm,
  parseCustomScale,
  pagePixels,
  paperFrameMm,
  posterLayout,
  printAttribution,
  printLegendRows,
  printStrokeScale,
  printViewport,
  zoomForPaperScale,
} from "./printLayout";

describe("print page size", () => {
  it("uses ISO sizes and swaps them for landscape", () => {
    expect(pageMm("a4", "portrait")).toEqual({ w: 210, h: 297 });
    expect(pageMm("a3", "landscape")).toEqual({ w: 420, h: 297 });
    expect(pageMm("a2", "landscape")).toEqual({ w: 594, h: 420 });
    expect(pageMm("a1", "landscape")).toEqual({ w: 841, h: 594 });
    expect(pageMm("a0", "portrait")).toEqual({ w: 841, h: 1189 });
  });

  it("converts millimetres to pixels at the requested dpi", () => {
    expect(pagePixels("a4", "landscape", 150)).toMatchObject({ w: 1754, h: 1240 });
  });
});

describe("poster layout", () => {
  it("fills the page inside a 20mm left margin and 5mm on the other sides", () => {
    const dpi = 150;
    const page = pagePixels("a0", "landscape", dpi);
    const layout = posterLayout(page.w, page.h, dpi);
    expect(layout.map.x).toBe(mmToPx(20, dpi));
    expect(layout.map.y).toBe(mmToPx(5, dpi));
    expect(layout.map.x + layout.map.w).toBe(page.w - mmToPx(5, dpi));
    expect(layout.map.y + layout.map.h).toBe(page.h - mmToPx(5, dpi));
    expect(layout.map.w).toBeGreaterThan(page.w * 0.9);
    expect(layout.map.h).toBeGreaterThan(page.h * 0.9);
  });
});

describe("print viewport", () => {
  it("crops a wide screen down to the paper aspect", () => {
    const view = printViewport(200, 100, 100, 100);
    expect(view.crop.w).toBeCloseTo(100);
    expect(view.crop.h).toBeCloseTo(100);
    expect(view.crop.x).toBeCloseTo(50);
    expect(view.crop.y).toBeCloseTo(0);
    expect(view.padding.left).toBeCloseTo(50);
  });

  it("crops a tall screen down to the paper aspect", () => {
    const view = printViewport(100, 200, 100, 100);
    expect(view.crop.w).toBeCloseTo(100);
    expect(view.crop.h).toBeCloseTo(100);
    expect(view.crop.y).toBeCloseTo(50);
    expect(view.padding.top).toBeCloseTo(50);
  });
});

describe("print helpers", () => {
  it("raises pixel ratio for the printed crop and stays within the bitmap cap", () => {
    expect(mapPixelRatio(800, 600, 800, 600, 800, 600, 2)).toBe(2);
    expect(mapPixelRatio(100, 100, 100, 100, 50, 50, 1)).toBe(1);
    expect(mapPixelRatio(2000, 1000, 2000, 1000, 8000, 4000, 1)).toBe(4);
    expect(mapPixelRatio(3000, 2000, 3000, 2000, 20000, 20000, 1)).toBe(2.73);
    expect(mapPixelRatio(2000, 1000, 1000, 1000, 8000, 8000, 1)).toBe(4.09);
  });

  it("picks a round scale bar that fits the requested width", () => {
    expect(niceScale(1, 120)).toEqual({ meters: 100, px: 100, label: "100 m" });
    expect(niceScale(2, 600)).toEqual({ meters: 1000, px: 500, label: "1 km" });
    expect(niceScale(0, 10)).toEqual({ meters: 0, px: 0, label: "" });
  });

  it("credits the basemap and drops legend rows that are off", () => {
    expect(printAttribution("light")).toContain("OpenStreetMap");
    expect(printAttribution("satellite")).toContain("Esri");
    expect(
      printLegendRows(
        [
          { label: "Pistă", color: "#00FF88" },
          { label: "Ilegal", color: "#FFD600", off: true },
        ],
        [{ label: "Școala 1", color: "#ff9100" }],
      ),
    ).toEqual([
      { kind: "item", label: "Pistă", color: "#00FF88" },
      { kind: "kicker", label: "Școli" },
      { kind: "item", label: "Școala 1", color: "#ff9100" },
    ]);
  });

  it("bounds every coordinate in the collections", () => {
    expect(
      featureCollectionBounds([
        {
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: [[24.1, 45.7], [24.2, 45.8]] },
            },
          ],
        },
        null,
      ]),
    ).toEqual([[24.1, 45.7], [24.2, 45.8]]);
    expect(featureCollectionBounds([null])).toBeNull();
  });

  it("ellipsizes text that does not fit", () => {
    const measure = (value: string) => value.length;
    expect(ellipsize("abcdef", 4, measure)).toBe("abc…");
    expect(ellipsize("ab", 4, measure)).toBe("ab");
  });

  it("knows the scale at which Sibiu fills A0", () => {
    const bounds: [[number, number], [number, number]] = [
      [24.115684350269174, 45.76498385115324],
      [24.184841524575646, 45.82422841991635],
    ];
    const frame = paperFrameMm("a0", "landscape");
    const minScale = minScaleForBounds(bounds, frame.w, frame.h);
    expect(minScale).toBeGreaterThan(7500);
    expect(minScale).toBeLessThan(8500);
    expect(zoomForPaperScale(0, 10000, 1000, 1000)).toBeCloseTo(13.93, 2);
    expect(printStrokeScale(1200, 1164)).toBeLessThan(0.2);
    const block = legendBlock(3, 16, 80, 400, 2000);
    expect(block.cols).toBe(1);
    expect(block.h).toBeLessThan(120);
  });

  it("pans a center by ground meters and reads a custom scale", () => {
    const shifted = panLngLat([24, 0], 111320, 111320);
    expect(shifted[0]).toBeCloseTo(25, 2);
    expect(shifted[1]).toBeCloseTo(1, 2);
    expect(parseCustomScale("8.000")).toBe(8000);
    expect(parseCustomScale("1:10.000")).toBe(10000);
    expect(parseCustomScale("50")).toBeNull();
  });

  it("pins a crosshair fraction to the printed map corners", () => {
    const nw: [number, number] = [24, 45.8];
    const se: [number, number] = [24.2, 45.6];
    expect(lngLatAtFrameFraction(nw, se, 0, 0)[0]).toBeCloseTo(24, 5);
    expect(lngLatAtFrameFraction(nw, se, 0, 0)[1]).toBeCloseTo(45.8, 5);
    expect(lngLatAtFrameFraction(nw, se, 1, 1)[0]).toBeCloseTo(24.2, 5);
    expect(lngLatAtFrameFraction(nw, se, 1, 1)[1]).toBeCloseTo(45.6, 5);
    const mid = lngLatAtFrameFraction(nw, se, 0.5, 0.5);
    expect(mid[0]).toBeCloseTo(24.1, 4);
    expect(mid[1]).toBeGreaterThan(45.69);
    expect(mid[1]).toBeLessThan(45.71);
  });
});
