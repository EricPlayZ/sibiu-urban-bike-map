import type { Map, MapGeoJSONFeature } from "maplibre-gl";
import { isMobileViewport } from "./breakpoints";

/** Extra slop around a tap so a 4–6px street is hittable, without grabbing empty gaps. */
export const TOUCH_HIT_RADIUS_PX = 16;
/** Small padding so a 4–6px street is still clickable with a mouse. */
export const MOUSE_HIT_RADIUS_PX = 8;

export type ScreenPt = { x: number; y: number };

export function distPointToSegment(p: ScreenPt, a: ScreenPt, b: ScreenPt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distPointToLineString(p: ScreenPt, pts: ScreenPt[]): number {
  if (!pts.length) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let min = Infinity;
  for (let i = 1; i < pts.length; i++) {
    min = Math.min(min, distPointToSegment(p, pts[i - 1], pts[i]));
  }
  return min;
}

export function isTouchLikePointer(originalEvent?: Event | null): boolean {
  if (typeof window !== "undefined") {
    if (window.matchMedia("(pointer: coarse)").matches) return true;
    if (isMobileViewport()) return true;
  }
  if (!originalEvent) return false;
  if ("pointerType" in originalEvent && (originalEvent as PointerEvent).pointerType === "touch") return true;
  if (typeof TouchEvent !== "undefined" && originalEvent instanceof TouchEvent) return true;
  return false;
}

export function hitRadiusPx(originalEvent?: Event | null): number {
  return isTouchLikePointer(originalEvent) ? TOUCH_HIT_RADIUS_PX : MOUSE_HIT_RADIUS_PX;
}

export function queryRenderedNear(map: Map, point: ScreenPt, layers: string[], radius: number): MapGeoJSONFeature[] {
  if (!layers.length) return [];
  if (radius <= 0) return map.queryRenderedFeatures([point.x, point.y], { layers });
  return map.queryRenderedFeatures(
    [
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y + radius],
    ],
    { layers }
  );
}

function projectLine(map: Map, coords: GeoJSON.Position[]): ScreenPt[] {
  return coords.map((c) => {
    const p = map.project(c as [number, number]);
    return { x: p.x, y: p.y };
  });
}

export function screenDistanceToGeometry(map: Map, point: ScreenPt, geometry: GeoJSON.Geometry | null): number {
  if (!geometry) return Infinity;
  switch (geometry.type) {
    case "Point": {
      const p = map.project(geometry.coordinates as [number, number]);
      return Math.hypot(p.x - point.x, p.y - point.y);
    }
    case "MultiPoint": {
      let d = Infinity;
      for (const c of geometry.coordinates) {
        const p = map.project(c as [number, number]);
        d = Math.min(d, Math.hypot(p.x - point.x, p.y - point.y));
      }
      return d;
    }
    case "LineString":
      return distPointToLineString(point, projectLine(map, geometry.coordinates));
    case "MultiLineString": {
      let d = Infinity;
      for (const line of geometry.coordinates) {
        d = Math.min(d, distPointToLineString(point, projectLine(map, line)));
      }
      return d;
    }
    case "Polygon":
      return distPointToPolygonRings(map, point, geometry.coordinates);
    case "MultiPolygon": {
      let d = Infinity;
      for (const poly of geometry.coordinates) {
        d = Math.min(d, distPointToPolygonRings(map, point, poly));
      }
      return d;
    }
    case "GeometryCollection": {
      let d = Infinity;
      for (const g of geometry.geometries) d = Math.min(d, screenDistanceToGeometry(map, point, g));
      return d;
    }
    default:
      return Infinity;
  }
}

function distPointToPolygonRings(map: Map, point: ScreenPt, rings: GeoJSON.Position[][]): number {
  let d = Infinity;
  for (const ring of rings) d = Math.min(d, distPointToLineString(point, projectLine(map, ring)));
  return d;
}

/** Nearest rendered feature within `maxDist` px. */
export function closestRenderedFeature(
  map: Map,
  point: ScreenPt,
  features: MapGeoJSONFeature[],
  maxDist: number
): MapGeoJSONFeature | null {
  let best: MapGeoJSONFeature | null = null;
  let bestD = maxDist;
  for (const f of features) {
    const d = screenDistanceToGeometry(map, point, f.geometry);
    if (d <= bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

export function queryClosestFeature(
  map: Map,
  point: ScreenPt,
  layers: string[],
  radius: number
): MapGeoJSONFeature | null {
  return closestRenderedFeature(map, point, queryRenderedNear(map, point, layers, radius), radius);
}
