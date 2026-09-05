/** Culori stabile per școală — mapate pe slug, aceleași la fiecare rulare. */

import { parseArondat } from "./schoolCatchment";

/**
 * Culori alese o dată pentru școlile din `schools.geojson`.
 * Nu depind de ordinea listei și nu se regenerează la reload.
 */
export const SCHOOL_COLORS: Readonly<Record<string, string>> = {
  scoala_4: "#d63df5",
  scoala_caragiale: "#09ae09",
  scoala_8: "#7af53d",
  liceu_constantin_noica: "#3e3ea2",
  scoala_nicolae_iorga: "#b7e920",
  scoala_21: "#8509ae",
  scoala_radu_selejan: "#d45e85",
  scoala_1: "#5ed4a3",
  scoala_2: "#888807",
  scoala_regina_maria: "#d4c05e",
  scoala_10: "#078872",
  scoala_11: "#1616f3",
  scoala_12: "#3df5f5",
  scoala_13: "#da4b2f",
  liceu_andrei_saguna: "#9c1c5c",
  scoala_18: "#8f5ed4",
  scoala_ioan_slavici: "#094eae",
  liceu_carol_1: "#40711e",
  scoala_23: "#a23e3e",
  scoala_25: "#794715",
  scoala_regele_ferdinand: "#45ed61",
  liceu_octavian_goga: "#e052bd",
};

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function fnv1a(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Culoare deterministă pentru slug-uri noi, fără a schimba maparea existentă. */
function colorFromSlug(slug: string): string {
  const hash = fnv1a(slug);
  return hslToHex(hash % 360, 72, 42 + (hash % 13));
}

export function schoolColor(slug: string): string {
  const key = String(slug || "").trim() || "scoala";
  return SCHOOL_COLORS[key] || colorFromSlug(key);
}

/** Păstrat pentru apeluri vechi — culorile cunoscute sunt fixe și nu se reatribue. */
export function assignSchoolColors(_slugs?: readonly string[]) {}

const MAX_SCHOOL_STRIPES = 8;

/** Copii paralele ale geometriei, una per școală vizibilă — MapLibre pictează o culoare / feature. */
export function explodeSchoolColorFeatures(
  features: GeoJSON.Feature[],
  selectedSchools: ReadonlySet<string>
): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const f of features) {
    const p = (f.properties || {}) as Record<string, unknown>;
    if (!p.has_arondat || !f.geometry) continue;
    const visible = parseArondat(p.arondat)
      .filter((slug) => selectedSchools.has(slug))
      .slice(0, MAX_SCHOOL_STRIPES);
    if (!visible.length) continue;
    const n = visible.length;
    const baseOff = Number(p.off_sch) || 0;
    const step = n > 2 ? 3.2 : n > 1 ? 4 : 0;
    visible.forEach((slug, i) => {
      const off = baseOff + (i - (n - 1) / 2) * step;
      out.push({
        type: "Feature",
        geometry: f.geometry,
        properties: {
          sid: p.sid,
          has_arondat: 1,
          school_slug: slug,
          school_color: schoolColor(slug),
          school_n: n,
          off_sch: off,
          flag_count: p.flag_count ?? 1,
        },
      });
    });
  }
  return out;
}
