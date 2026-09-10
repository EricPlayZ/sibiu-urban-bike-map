/** Reguli OSM pentru rețeaua pietonală / ciclopietonală. */

export type IsochroneProfile = "bike" | "walk";

export type OsmWayTags = {
  highway: string;
  foot?: string;
  bicycle?: string;
  access?: string;
  oneway?: string;
  onewayBicycle?: string;
  cycleway?: string;
};

const DENY = new Set(["no", "private", "military", "discouraged"]);
const ALLOW = new Set(["yes", "designated", "permissive", "official"]);

const WALK_BAN = new Set([
  "motorway",
  "motorway_link",
  "proposed",
  "construction",
  "abandoned",
  "razed",
  "raceway",
  "elevator",
  "bus_stop",
  "platform",
]);

const BIKE_BAN = new Set([
  "motorway",
  "motorway_link",
  "proposed",
  "construction",
  "abandoned",
  "razed",
  "raceway",
  "elevator",
  "bus_stop",
  "platform",
  "steps",
  "corridor",
]);

const BIKE_NEED_TAG = new Set(["footway", "pedestrian", "steps"]);

function taggedAllow(v: string | undefined) {
  return Boolean(v) && ALLOW.has(v!);
}

function taggedDeny(v: string | undefined) {
  return Boolean(v) && (DENY.has(v!) || v === "dismount");
}

export function walkAllowed(t: OsmWayTags): boolean {
  if (taggedDeny(t.foot)) return false;
  if (WALK_BAN.has(t.highway) && !taggedAllow(t.foot)) return false;
  if ((t.highway === "trunk" || t.highway === "trunk_link") && !taggedAllow(t.foot)) return false;
  if (t.access && DENY.has(t.access) && !taggedAllow(t.foot)) return false;
  return true;
}

export function bikeAllowed(t: OsmWayTags): boolean {
  if (taggedDeny(t.bicycle)) return false;
  if (BIKE_BAN.has(t.highway) && !taggedAllow(t.bicycle)) return false;
  if (BIKE_NEED_TAG.has(t.highway) && !taggedAllow(t.bicycle)) return false;
  if (t.access && DENY.has(t.access) && !taggedAllow(t.bicycle)) return false;
  return true;
}

/** 1 = doar înainte, -1 = doar invers, 0 = ambele. */
export function bikeOneway(t: OsmWayTags): -1 | 0 | 1 {
  const ob = t.onewayBicycle;
  if (ob === "no" || ob === "false" || ob === "0") return 0;
  if (ob === "yes" || ob === "true" || ob === "1") return 1;
  if (ob === "-1" || ob === "reverse") return -1;
  if (t.cycleway === "opposite" || t.cycleway === "opposite_lane" || t.cycleway === "opposite_track") return 0;
  const o = t.oneway;
  if (o === "yes" || o === "true" || o === "1") return 1;
  if (o === "-1" || o === "reverse") return -1;
  return 0;
}

export const WALK_KMH = 5;
export const BIKE_KMH = 15;

export function speedKmh(profile: IsochroneProfile, highway: string): number {
  if (profile === "walk") return highway === "steps" ? 2.4 : WALK_KMH;
  if (highway === "cycleway") return 18;
  if (highway === "path" || highway === "footway" || highway === "pedestrian" || highway === "living_street") return 12;
  if (highway === "track" || highway === "service") return 12;
  return BIKE_KMH;
}

export function tagsFromWay(way: {
  h: string;
  f?: string;
  b?: string;
  a?: string;
  o?: string;
  ob?: string;
  cw?: string;
}): OsmWayTags {
  return {
    highway: way.h,
    foot: way.f,
    bicycle: way.b,
    access: way.a,
    oneway: way.o,
    onewayBicycle: way.ob,
    cycleway: way.cw,
  };
}
