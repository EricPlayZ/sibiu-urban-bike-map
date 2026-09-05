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
  building: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4H14a1.5 1.5 0 0 1 1.5 1.5V21M10 21V11h8.5A1.5 1.5 0 0 1 20 12.5V21M8 8h.01M8 12h.01M12 8h.01M12 12h.01M16 14h.01M16 17h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  package: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  help: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.6 9.2a2.6 2.6 0 1 1 3.7 2.4c-.7.4-1.3.9-1.3 1.9M12 17.2h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
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
      .map((p) => `<span class="mp-seg" style="width:${(p.v * 100).toFixed(1)}%;background:${p.color}" title="${escapeHtml(p.label)} ${pct(p.v)}"></span>`)
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
  return `<span class="school-pin" style="--school-c:${escapeHtml(color)}" title="${escapeHtml(name)}">
    <span class="school-pin-glow" aria-hidden="true"></span>
    <span class="school-pin-core" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 10.5 12 5l9 5.5-9 5.5L3 10.5Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/><path d="M7 13v4.2c2 1.4 8 1.4 10 0V13M19 11.5V16.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </span>
    <span class="school-pin-point" aria-hidden="true"></span>
  </span>`;
}

/** Popup MapLibre pentru clădire (vizualizare — fără placeholder foto). */
export function buildingPopupHtml(type: string) {
  const meta: Record<string, { label: string; color: string; blurb: string; icon: keyof typeof ICONS }> = {
    casa: { label: "Casă", color: "#2f9e44", blurb: "Casă", icon: "home" },
    bloc: { label: "Bloc", color: "#e03131", blurb: "Bloc", icon: "building" },
    altceva: { label: "Altceva", color: "#868e96", blurb: "Altă categorie decât casă / bloc", icon: "package" },
    necunoscut: { label: "Necunoscut", color: "#ced4da", blurb: "Neclasificat încă", icon: "help" },
  };
  const current = meta[type] || meta.necunoscut;

  return `<div class="map-popup map-popup-bldg">
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
            <span class="mp-value">${escapeHtml(current.blurb)}</span>
          </div>
        </div>
      </div>
    </div>
  </div>`;
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

  return `<div class="map-popup">
    <div class="mp-body">
      <strong class="mp-title">${escapeHtml(title)}</strong>
      <div class="mp-chips">
        <span class="mp-chip" style="--c:${schoolColor(slug)}">Școală</span>
        <span class="mp-chip" style="--c:#5b6cff">${assigned.length} străzi</span>
      </div>
      <div class="mp-list">
        ${row("school", "school", "Străzi arondate", String(assigned.length))}
        ${row(bike ? "bike" : "off", "bike", "Cu pistă biciclete", String(bike))}
        ${row(illegal ? "illegal" : "off", "illegal", "Cu parcare ilegală", String(illegal))}
      </div>
    </div>
  </div>`;
}

export function neighborhoodPopupHtml(name: string) {
  return `<div class="map-popup">
    <div class="mp-body">
      <strong class="mp-title">${escapeHtml(name)}</strong>
      <div class="mp-chips"><span class="mp-chip" style="--c:${LAYER_COLORS.base}">Cartier</span></div>
    </div>
  </div>`;
}
