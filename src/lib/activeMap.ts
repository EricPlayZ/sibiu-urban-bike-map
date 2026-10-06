import type { Map } from "maplibre-gl";

let active: Map | null = null;

export function setActiveMap(map: Map | null) {
  active = map;
}

export function getActiveMap() {
  return active;
}
