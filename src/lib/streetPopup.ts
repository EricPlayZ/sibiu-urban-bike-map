import { BUILDING_TYPES, buildingTypeMeta, coerceBuildingType } from "./buildingTypes";
import type { NeighborhoodInfo } from "./neighborhoodInfo";
import { BIKE_DOOR_LABEL, BIKE_SAFE_LABEL } from "./layers";
import { streetAssignedToSchool, streetSchoolSlugs } from "./schoolCatchment";
import { schoolColor } from "./schoolColors";
import {
  featureHasIllegalParking,
  featureHasReservedParking,
  flagSpaceStory,
  freeSidewalkHint,
  LAYER_COLORS,
  pct,
  spaceEquityVerdict,
  spaceShares,
  streetBikeLaneStatus,
  streetHasBikeLane,
  type Measurement,
} from "./space";

function schoolLabel(slug: string, schools: GeoJSON.FeatureCollection | null) {
  if (!schools || !slug) return slug;
  const hit = schools.features.find((f) => (f.properties as { slug?: string })?.slug === slug);
  return String((hit?.properties as { denumire?: string })?.denumire || slug);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const ICONS = {
  bike: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="16.5" r="3.25" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="16.5" r="3.25" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.5 16.5 10 8h3l2.5 5M13 8l2-4h3M10 8l7.5 8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  illegal: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 21 19H3L12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4.5M12 17.5h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  reserved: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 12h4.5a2.5 2.5 0 0 0 0-5H7v10M7 12h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  school: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 5l9 5.5-9 5.5L3 10.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 13v4.5c2 1.5 8 1.5 10 0V13M19 11.5V17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  empty: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 12h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  photo: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.75"/><circle cx="9" cy="11" r="2" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="m7.5 17 3.2-3.6a1.5 1.5 0 0 1 2.2 0L16 16l1.2-1.3a1.5 1.5 0 0 1 2.2.1L21 17" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  homes: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 11.2 8 6.2l5.5 5V20H2.5v-8.8Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M11 12.2 16.5 7.2 22 12.2V20h-8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  building: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4H14a1.5 1.5 0 0 1 1.5 1.5V21M10 21V11h8.5A1.5 1.5 0 0 1 20 12.5V21M8 8h.01M8 12h.01M12 8h.01M12 12h.01M16 14h.01M16 17h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  tower: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V21M7 21h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 7h.01M14 7h.01M10 11h.01M14 11h.01M10 15h.01M14 15h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  package: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  store: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5 5.5 4h13L20 9.5M4 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 6 0 2.5 2.5 0 0 0 5 0M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  help: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.6 9.2a2.6 2.6 0 1 1 3.7 2.4c-.7.4-1.3.9-1.3 1.9M12 17.2h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  layers: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12.5l9 5 9-5M3 16.5l9 5 9-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ruler: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5 15.5 20 20 15.5 8.5 4 4 8.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7.5 11.5 9 10M10.5 13.5 12 12M13.5 15.5 15 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  list: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  segment: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 9 6l3 6 3-4 5 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12.5s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5-9.5-6.5-9.5-6.5Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12.5" r="2.75" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4.5 20.5 22M10.2 10.7a2.8 2.8 0 0 0 3.8 3.8M6.4 6.9C4.2 8.4 2.8 10.4 2.5 12.5c0 0 3.5 6.5 9.5 6.5 1.6 0 3-.4 4.2-1M17.6 17.1c2.2-1.5 3.6-3.5 3.9-5.6 0 0-3.5-6.5-9.5-6.5-1.1 0-2.1.2-3 .5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  funnel: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.5 8v5.5L10 20v-7L4 5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  coverage: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16M8 15V9M12 17V7M16 13v-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
} as const;

type RowTone = "bike" | "illegal" | "reserved" | "school" | "muted" | "off";

function row(tone: RowTone, icon: keyof typeof ICONS, label: string, value: string) {
  return `<div class="mp-row mp-${tone}"><span class="mp-ico">${ICONS[icon]}</span><div class="mp-copy"><span class="mp-label">${escapeHtml(label)}</span><span class="mp-value">${escapeHtml(value)}</span></div></div>`;
}

function schoolRow(slugs: string[], schools: GeoJSON.FeatureCollection | null) {
  const names = slugs
    .map((slug) => {
      const label = escapeHtml(schoolLabel(slug, schools));
      const color = schoolColor(slug);
      return `<span class="mp-school-name" style="--c:${color}">${label}</span>`;
    })
    .join("");
  return `<div class="mp-row mp-school mp-row-schools"><span class="mp-ico">${ICONS.school}</span><div class="mp-copy"><span class="mp-label">Arondată la</span><div class="mp-school-names">${names}</div></div></div>`;
}

function spaceBreakdownHtml(m?: Measurement | null, props?: Record<string, unknown>) {
  const shares = spaceShares(m);
  if (shares) {
    const verdict = spaceEquityVerdict(shares);
    const sidewalkHint = freeSidewalkHint(m);
    const parts = [
      { label: "Mașini", color: "#5c6670", v: shares.carriageway },
      { label: "Parcare", color: "#e6a700", v: shares.parking },
      { label: "Pietoni", color: "#1b9a8a", v: shares.sidewalk },
      { label: "Biciclete", color: "#2f9e44", v: shares.bike },
      { label: "Verde", color: "#1b5e20", v: shares.green },
    ].filter((p) => p.v > 0.005);

    const bar = parts
      .map((p) => `<span class="mp-seg" style="width:${(p.v * 100).toFixed(1)}%;background:${p.color}" data-tip="${escapeHtml(p.label)} ${pct(p.v)}"></span>`)
      .join("");
    const legs = parts.map((p) => `<span><i style="background:${p.color}"></i>${escapeHtml(p.label)} ${pct(p.v)}</span>`).join("");

    return `<div class="mp-space">
      <div class="mp-space-head">
        <strong>${escapeHtml(verdict.title)}</strong>
        <p>${escapeHtml(verdict.detail)}</p>
      </div>
      <div class="mp-space-bar" aria-hidden="true">${bar}</div>
      <div class="mp-space-legs">${legs}</div>
      ${sidewalkHint ? `<p class="mp-space-note">${escapeHtml(sidewalkHint)}</p>` : ""}
    </div>`;
  }

  const story = props ? flagSpaceStory(props) : null;
  if (!story) return "";
  return `<div class="mp-space mp-space-soft">
    <div class="mp-space-head">
      <strong>Cum se simte spațiul</strong>
      <p>${escapeHtml(story)}</p>
    </div>
  </div>`;
}

/** HTML pentru popup-ul MapLibre pe hartă. */
export function streetPopupHtml(
  props: Record<string, unknown>,
  schools: GeoJSON.FeatureCollection | null,
  measurement?: Measurement | null
) {
  const title = String(props.name || "Stradă");
  const photo = String(props.photo_url || props.image_url || "").trim();
  const bikeStatus = streetBikeLaneStatus(props, measurement);
  const bike = streetHasBikeLane(props, measurement);
  const illegal = featureHasIllegalParking(props);
  const reserved = featureHasReservedParking(props);
  const arondari = streetSchoolSlugs(props);

  const media = photo
    ? `<div class="mp-media"><img src="${escapeHtml(photo)}" alt="" loading="lazy" /></div>`
    : `<div class="mp-media mp-media-empty" aria-hidden="true"><span class="mp-media-ico">${ICONS.photo}</span><span>Foto stradă — în curând</span></div>`;

  const spaceHtml = spaceBreakdownHtml(measurement, props);

  const rows: string[] = [];
  if (bikeStatus === "door") {
    rows.push(row("bike", "bike", BIKE_DOOR_LABEL, "Da"));
  } else if (bikeStatus === "safe") {
    rows.push(row("bike", "bike", BIKE_SAFE_LABEL, "Da"));
  } else if (bikeStatus === "none") {
    rows.push(row("off", "bike", "Pistă biciclete", "Nu"));
  }
  if (illegal) rows.push(row("illegal", "illegal", "Parcare ilegală pe trotuar", "Da"));
  if (reserved) rows.push(row("reserved", "reserved", "Parcare amenajată pe trotuar", "Da"));
  if (arondari.length) rows.push(schoolRow(arondari, schools));
  if (!bike && !illegal && !reserved && !arondari.length && !spaceHtml) {
    rows.push(row("muted", "empty", "Date stradă", "Nu există date specifice"));
  }

  const chips: string[] = [];
  if (bikeStatus === "safe") chips.push(`<span class="mp-chip" style="--c:${LAYER_COLORS.bike}">${BIKE_SAFE_LABEL}</span>`);
  if (bikeStatus === "door") chips.push(`<span class="mp-chip" style="--c:${LAYER_COLORS.bikeDoor}">${BIKE_DOOR_LABEL}</span>`);
  if (reserved) chips.push(`<span class="mp-chip" style="--c:${LAYER_COLORS.reserved}">Parcare</span>`);
  if (illegal) chips.push(`<span class="mp-chip" style="--c:${LAYER_COLORS.illegal}">Ilegal</span>`);
  if (spaceShares(measurement)) {
    const chipLabel = measurement?.source === "local" ? "Editată local" : "Măsurată";
    chips.push(`<span class="mp-chip" style="--c:${LAYER_COLORS.edited}">${chipLabel}</span>`);
  }

  return `<div class="map-popup">
    ${media}
    <div class="mp-body">
      <strong class="mp-title">${escapeHtml(title)}</strong>
      ${chips.length ? `<div class="mp-chips">${chips.join("")}</div>` : ""}
      ${spaceHtml}
      <div class="mp-list">${rows.join("")}</div>
    </div>
  </div>`;
}

/** SVG marker școală — culoarea e cea a arondării pe hartă. */
export function schoolMarkerHtml(name: string, color = "#5b6cff") {
  return `<span class="school-pin" style="--school-c:${escapeHtml(color)}" data-tip="${escapeHtml(name)}">
    <span class="school-pin-glow" aria-hidden="true"></span>
    <span class="school-pin-core" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 10.5 12 5l9 5.5-9 5.5L3 10.5Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/><path d="M7 13v4.2c2 1.4 8 1.4 10 0V13M19 11.5V16.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </span>
    <span class="school-pin-point" aria-hidden="true"></span>
  </span>`;
}

export type PopupAction = {
  act: "only-nb" | "hide-nb" | "only-school" | "hide-school" | "only-bldg" | "hide-bldg";
  id: string;
  tip: string;
};

/** Butoane de filtrare din popup; click-ul e preluat prin delegare în MapView (`data-ubr-act`). */
function actionsHtml(actions: PopupAction[]) {
  if (!actions.length) return "";
  const btns = actions
    .map((a) => {
      const only = a.act.startsWith("hide") ? false : true;
      const icon = only ? ICONS.funnel : ICONS.eyeOff;
      const cls = only ? "mp-act-only" : "mp-act-hide";
      return `<button type="button" class="mp-act mp-act-icon ${cls}" data-ubr-act="${a.act}" data-ubr-id="${escapeHtml(a.id)}" data-tip="${escapeHtml(a.tip)}" aria-label="${escapeHtml(a.tip)}">${icon}</button>`;
    })
    .join("");
  return `<div class="mp-actions">${btns}</div>`;
}

/** Secțiune pliabilă: informația nu aglomerează popup-ul dacă nu o vrei. */
function fold(title: string, summary: string, body: string, open = false) {
  return `<details class="mp-fold"${open ? " open" : ""}><summary><span class="mp-fold-title">${escapeHtml(title)}</span><span class="mp-fold-sum">${escapeHtml(summary)}</span></summary><div class="mp-fold-body">${body}</div></details>`;
}

function statLine(label: string, value: string, icon: keyof typeof ICONS, tone: RowTone = "muted", color?: string) {
  const icoStyle = color ? ` style="color:${escapeHtml(color)}"` : "";
  return `<div class="mp-row mp-${tone} mp-stat-row"><span class="mp-ico"${icoStyle}>${ICONS[icon]}</span><div class="mp-copy"><span class="mp-label">${escapeHtml(label)}</span><span class="mp-value">${escapeHtml(value)}</span></div></div>`;
}

/** Popup MapLibre pentru clădire (vizualizare — fără placeholder foto). */
export function buildingPopupHtml(type: string, below = "") {
  const current = buildingTypeMeta(type);
  const typeId = coerceBuildingType(type);
  const actions = actionsHtml([
    { act: "only-bldg", id: typeId, tip: "Arată doar acest tip" },
    { act: "hide-bldg", id: typeId, tip: "Ascunde acest tip" },
  ]);

  return `<div class="map-popup-stack"><div class="map-popup map-popup-bldg">
    <div class="mp-body">
      <strong class="mp-title">Clădire</strong>
      <div class="mp-chips">
        <span class="mp-chip" style="--c:${current.color}">${escapeHtml(current.label)}</span>
      </div>
      <div class="mp-list">
        <div class="mp-row mp-muted">
          <span class="mp-ico" style="color:${current.color}">${ICONS[current.icon]}</span>
          <div class="mp-copy">
            <span class="mp-label">Tip</span>
            <span class="mp-value">${escapeHtml(current.label)}</span>
          </div>
        </div>
      </div>
      ${actions}
    </div>
  </div>${below ? `<div class="mp-stack-sep" aria-hidden="true"></div>${below}` : ""}</div>`;
}

export function assignFlagOffsets(p: Record<string, unknown>, opts: { includeSchool: boolean; includeEdit?: boolean }) {
  const keys: ("bike" | "door" | "rsv" | "ill" | "sch" | "edit")[] = [];
  if (p.show_bike) keys.push("bike");
  if (p.show_bike_door) keys.push("door");
  if (p.show_rsrvd) keys.push("rsv");
  if (p.show_illgl) keys.push("ill");
  if (opts.includeSchool && p.has_arondat) keys.push("sch");
  if (opts.includeEdit && p.edited) keys.push("edit");

  p.off_bike = 0;
  p.off_door = 0;
  p.off_rsv = 0;
  p.off_ill = 0;
  p.off_sch = 0;
  p.off_edit = 0;
  p.flag_count = keys.length;

  const step = keys.length > 2 ? 3.6 : 4.2;
  keys.forEach((k, i) => {
    const off = (i - (keys.length - 1) / 2) * step;
    if (k === "bike") p.off_bike = off;
    if (k === "door") p.off_door = off;
    if (k === "rsv") p.off_rsv = off;
    if (k === "ill") p.off_ill = off;
    if (k === "sch") p.off_sch = off;
    if (k === "edit") p.off_edit = off;
  });
}

/** Popup pentru marker școală. */
export function schoolPopupHtml(
  props: Record<string, unknown>,
  streets: GeoJSON.FeatureCollection | null,
  neighborhoods: Set<string>
) {
  const title = String(props.denumire || props.name || "Școală");
  const slug = String(props.slug || "");

  const assigned = (streets?.features || []).filter((f) => {
    const p = (f.properties || {}) as Record<string, unknown>;
    if (!streetAssignedToSchool(p, slug)) return false;
    const cartier = String(p.cartier || "");
    return !cartier || neighborhoods.has(cartier);
  });
  const bike = assigned.filter((f) => streetHasBikeLane(f.properties as Record<string, unknown>)).length;
  const illegal = assigned.filter((f) => featureHasIllegalParking(f.properties as Record<string, unknown>)).length;

  const details = `<div class="mp-list">
        ${row("school", "school", "Străzi arondate", String(assigned.length))}
        ${row(bike ? "bike" : "off", "bike", "Cu pistă biciclete", String(bike))}
        ${row(illegal ? "illegal" : "off", "illegal", "Cu parcare ilegală", String(illegal))}
      </div>`;

  return `<div class="map-popup">
    <div class="mp-body">
      <strong class="mp-title">${escapeHtml(title)}</strong>
      <div class="mp-chips">
        <span class="mp-chip" style="--c:${schoolColor(slug)}">Școală</span>
        <span class="mp-chip" style="--c:#5b6cff">${assigned.length} străzi</span>
      </div>
      ${fold("Străzi arondate", `${assigned.length} străzi`, details)}
      ${slug ? actionsHtml([
        { act: "only-school", id: slug, tip: "Arată doar această școală" },
        { act: "hide-school", id: slug, tip: "Ascunde această școală" },
      ]) : ""}
    </div>
  </div>`;
}

const fmtKm = (v: number) => `${v.toLocaleString("ro-RO", { maximumFractionDigits: 2 })} km`;
const fmtPct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : "—");

/**
 * Popup de cartier. Fără `info` (ex. date încă neîncărcate) arată doar numele; cu `info`, secțiuni pliabile.
 * Filtrul nu se schimbă niciodată din simplul click pe cartier — doar din butoanele de jos.
 */
export function neighborhoodPopupHtml(name: string, info?: NeighborhoodInfo | null, slug?: string) {
  const id = slug || info?.slug || "";
  const actions = id
    ? actionsHtml([
        { act: "only-nb", id, tip: "Arată doar acest cartier" },
        { act: "hide-nb", id, tip: "Ascunde acest cartier" },
      ])
    : "";
  if (!info) {
    return `<div class="map-popup">
    <div class="mp-body">
      <strong class="mp-title">${escapeHtml(name)}</strong>
      <div class="mp-chips"><span class="mp-chip" style="--c:${LAYER_COLORS.base}">Cartier</span></div>
      ${actions}
    </div>
  </div>`;
  }

  const s = info.streets;
  const cov = info.coverage;
  const streetsBody = `<div class="mp-list mp-stats">
      ${statLine("Segmente de stradă", String(s.segments), "segment")}
      ${statLine("Străzi (după nume)", String(s.names), "list")}
      ${statLine("Lungime totală", fmtKm(s.km), "ruler")}
      ${statLine(BIKE_SAFE_LABEL, fmtKm(s.bikeSafeKm), "bike", "bike", LAYER_COLORS.bike)}
      ${statLine(BIKE_DOOR_LABEL, fmtKm(s.bikeDoorKm), "bike", "bike", LAYER_COLORS.bikeDoor)}
      ${statLine("Parcare ilegală pe trotuar", fmtKm(s.illegalKm), "illegal", "illegal", LAYER_COLORS.illegal)}
      ${statLine("Parcare amenajată pe trotuar", fmtKm(s.reservedKm), "reserved", "reserved", LAYER_COLORS.reserved)}
      ${statLine("Segmente arondate la școli", String(s.schoolAssigned), "school", "school", "#5b6cff")}
    </div>`;

  const schoolsBody = info.schools.length
    ? `<div class="mp-list">${info.schools
        .map((sc) => {
          const label = escapeHtml(sc.name);
          const color = schoolColor(sc.slug);
          return `<div class="mp-row mp-school"><span class="mp-ico">${ICONS.school}</span><div class="mp-copy"><span class="mp-label">Școală</span><span class="mp-value"><span class="mp-school-name" style="--c:${color}">${label}</span></span></div></div>`;
        })
        .join("")}</div>`
    : `<p class="mp-note">Nicio școală marcată în acest cartier.</p>`;

  let buildingsSummary = "neîncărcate";
  let buildingsBody = `<p class="mp-note">Clădirile nu sunt încărcate încă.</p>`;
  if (info.buildings) {
    const b = info.buildings;
    buildingsSummary = `${b.total.toLocaleString("ro-RO")} clădiri`;
    buildingsBody = `<div class="mp-list">${BUILDING_TYPES.map((t) => {
      const meta = buildingTypeMeta(t);
      const icon = meta.icon in ICONS ? (meta.icon as keyof typeof ICONS) : "building";
      return statLine(
        meta.label,
        `${b.byType[t].toLocaleString("ro-RO")} · ${fmtPct(b.byType[t], b.total)}`,
        icon,
        "muted",
        meta.color
      );
    }).join("")}</div>`;
  }

  const coverageBody = `<div class="mp-meter" role="img" aria-label="Acoperire măsurători ${fmtPct(cov.measuredSegments, cov.totalSegments)}"><span style="width:${cov.totalSegments ? Math.round((cov.measuredSegments / cov.totalSegments) * 100) : 0}%"></span></div>
    <div class="mp-list">
      ${statLine("Segmente cu date", `${cov.measuredSegments} din ${cov.totalSegments}`, "segment")}
      ${statLine("Lungime cu date", `${fmtKm(cov.measuredKm)} din ${fmtKm(cov.totalKm)}`, "ruler")}
      ${statLine("Segmente cu lățimi complete", String(cov.withWidths), "layers")}
      ${statLine("Editate de echipă", String(cov.edited), "coverage", "muted", LAYER_COLORS.edited)}
    </div>`;

  return `<div class="map-popup map-popup-nb">
    <div class="mp-body">
      <strong class="mp-title">${escapeHtml(info.name)}</strong>
      <div class="mp-chips">
        <span class="mp-chip" style="--c:${LAYER_COLORS.base}">Cartier</span>
        <span class="mp-chip" style="--c:${LAYER_COLORS.edited}">${fmtPct(cov.measuredSegments, cov.totalSegments)} acoperit</span>
      </div>
      ${fold("Străzi", fmtKm(s.km), streetsBody)}
      ${fold("Școli", String(info.schools.length), schoolsBody)}
      ${fold("Clădiri", buildingsSummary, buildingsBody)}
      ${fold("Acoperire măsurători", fmtPct(cov.measuredSegments, cov.totalSegments), coverageBody)}
      ${actions}
    </div>
  </div>`;
}
