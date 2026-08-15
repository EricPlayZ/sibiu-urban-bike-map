import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Bug, CheckCircle2, Info, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useApp } from "../store";
import type { ImportIssue, MatchIssueCode } from "../lib/streetMatch";

const SEV_ORDER = { error: 0, warn: 1, info: 2 } as const;
type Sev = "all" | "error" | "warn" | "info";

const CODE_LABEL: Record<MatchIssueCode, string> = {
  csv_empty_widths: "Lățimi goale",
  csv_no_osm_match: "Fără potrivire OSM",
  csv_ambiguous_osm: "Potrivire ambiguă",
  csv_merged_segments: "Segmente mediate",
  osm_unassigned_neighborhood: "Fără cartier",
  osm_no_csv_in_neighborhood: "OSM fără CSV",
  csv_parse_columns: "Coloane CSV",
  geometry_source: "Sursă geometrie",
};

function streetOf(i: ImportIssue) {
  return String(i.csv_name || i.osm_name || "").trim();
}

function toggleValue(list: string[], value: string) {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function ImportReportPanel() {
  const open = useApp((s) => s.importReportOpen);
  const report = useApp((s) => s.importReport);
  const close = useApp((s) => s.closeImportReport);
  const [sev, setSev] = useState<Sev>("all");
  const [codesOn, setCodesOn] = useState<MatchIssueCode[]>([]);
  const [cartiersOn, setCartiersOn] = useState<string[]>([]);
  const [streetsOn, setStreetsOn] = useState<string[]>([]);
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    if (!report) return { error: 0, warn: 0, info: 0 };
    return report.issues.reduce(
      (acc, i) => {
        acc[i.severity]++;
        return acc;
      },
      { error: 0, warn: 0, info: 0 }
    );
  }, [report]);

  const cartiers = useMemo(() => {
    if (!report) return [] as string[];
    return [...new Set(report.issues.map((i) => i.neighborhood_slug).filter(Boolean) as string[])].sort((a, b) =>
      a.localeCompare(b, "ro")
    );
  }, [report]);

  const streets = useMemo(() => {
    if (!report) return [] as string[];
    const names = new Set<string>();
    for (const i of report.issues) {
      if (cartiersOn.length && (!i.neighborhood_slug || !cartiersOn.includes(i.neighborhood_slug))) continue;
      const n = streetOf(i);
      if (n) names.add(n);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "ro"));
  }, [report, cartiersOn]);

  const codes = useMemo(() => {
    if (!report) return [] as MatchIssueCode[];
    return [...new Set(report.issues.map((i) => i.code))].sort();
  }, [report]);

  const issues = useMemo(() => {
    if (!report) return [];
    const needle = q.trim().toLowerCase();
    return [...report.issues]
      .filter((i) => (sev === "all" ? true : i.severity === sev))
      .filter((i) => (codesOn.length ? codesOn.includes(i.code) : true))
      .filter((i) => (cartiersOn.length ? Boolean(i.neighborhood_slug && cartiersOn.includes(i.neighborhood_slug)) : true))
      .filter((i) => (streetsOn.length ? streetsOn.includes(streetOf(i)) : true))
      .filter((i) => {
        if (!needle) return true;
        const hay = `${i.detail} ${i.hint || ""} ${i.csv_name || ""} ${i.osm_name || ""} ${i.neighborhood_slug || ""} ${i.code} ${CODE_LABEL[i.code]}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || streetOf(a).localeCompare(streetOf(b), "ro"));
  }, [report, sev, codesOn, cartiersOn, streetsOn, q]);

  const toggleSev = (next: Exclude<Sev, "all">) => setSev((cur) => (cur === next ? "all" : next));

  const resetFilters = () => {
    setSev("all");
    setCodesOn([]);
    setCartiersOn([]);
    setStreetsOn([]);
    setQ("");
  };

  const filtered = sev !== "all" || codesOn.length > 0 || cartiersOn.length > 0 || streetsOn.length > 0 || q.trim().length > 0;

  const toggleCartier = (slug: string) => {
    const next = toggleValue(cartiersOn, slug);
    setCartiersOn(next);
    if (!next.length) return;
    setStreetsOn((cur) => {
      if (!cur.length) return cur;
      const allowed = new Set<string>();
      for (const i of report?.issues || []) {
        if (i.neighborhood_slug && next.includes(i.neighborhood_slug)) {
          const n = streetOf(i);
          if (n) allowed.add(n);
        }
      }
      return cur.filter((s) => allowed.has(s));
    });
  };

  return (
    <AnimatePresence>
      {open && report && (
        <motion.aside
          className="panel import-report-panel"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.2 }}
        >
          <div className="panel-head">
            <div>
              <h2>
                <Bug size={18} strokeWidth={2.2} /> Import CSV / OSM
              </h2>
              <p className="sub">Potriviri CSV ↔ OSM, pe cartier și stradă.</p>
            </div>
            <button type="button" className="icon-x" onClick={close} aria-label="Închide">
              <X size={18} />
            </button>
          </div>

          <div className="import-kpis">
            <div className="import-kpi">
              <span>Geometrie</span>
              <b>{report.geometrySource.replace(".geojson", "")}</b>
            </div>
            <div className="import-kpi">
              <span>Străzi OSM</span>
              <b>
                {report.assignedCount}
                <small> / {report.streetCount}</small>
              </b>
            </div>
            <div className="import-kpi">
              <span>CSV potrivite</span>
              <b>
                {report.matchedCsvRows}
                <small> · {report.csvFilesLoaded.length || 0} fișiere</small>
              </b>
            </div>
          </div>
          {report.csvFilesLoaded.length > 0 && (
            <p className="import-csv-files">{report.csvFilesLoaded.join(" · ")}</p>
          )}

          <div className="import-sev-toggles" role="group" aria-label="Filtru severitate">
            <button type="button" className={`import-sev-btn sev-error ${sev === "error" ? "on" : ""}`} onClick={() => toggleSev("error")}>
              <AlertTriangle size={14} /> {counts.error} erori
            </button>
            <button type="button" className={`import-sev-btn sev-warn ${sev === "warn" ? "on" : ""}`} onClick={() => toggleSev("warn")}>
              <AlertTriangle size={14} /> {counts.warn} warn
            </button>
            <button type="button" className={`import-sev-btn sev-info ${sev === "info" ? "on" : ""}`} onClick={() => toggleSev("info")}>
              <Info size={14} /> {counts.info} info
            </button>
          </div>

          <div className="import-filters">
            <label className="import-search">
              <Search size={15} strokeWidth={2.2} aria-hidden />
              <input type="search" placeholder="Caută stradă, cartier, mesaj…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>

            <div className="import-filter-block">
              <div className="import-filter-label">
                <span>Cartier</span>
                <small>{cartiersOn.length ? `${cartiersOn.length} selectate` : "toate"}</small>
              </div>
              <div className="chip-wrap import-chip-wrap">
                {cartiers.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`chip ${cartiersOn.includes(c) ? "on" : ""}`}
                    onClick={() => toggleCartier(c)}
                    aria-pressed={cartiersOn.includes(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="import-filter-block">
              <div className="import-filter-label">
                <span>Stradă</span>
                <small>{streetsOn.length ? `${streetsOn.length} selectate` : "toate"}</small>
              </div>
              <div className="chip-wrap import-chip-wrap import-chip-wrap-scroll">
                {streets.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`chip ${streetsOn.includes(s) ? "on" : ""}`}
                    onClick={() => setStreetsOn(toggleValue(streetsOn, s))}
                    aria-pressed={streetsOn.includes(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="import-filter-block">
              <div className="import-filter-label">
                <span>Tip</span>
                <small>{codesOn.length ? `${codesOn.length} selectate` : "toate"}</small>
              </div>
              <div className="chip-wrap import-chip-wrap">
                {codes.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`chip ${codesOn.includes(c) ? "on" : ""}`}
                    onClick={() => setCodesOn(toggleValue(codesOn, c) as MatchIssueCode[])}
                    aria-pressed={codesOn.includes(c)}
                  >
                    {CODE_LABEL[c] || c}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="import-list-head">
            <span>
              {issues.length} din {report.issues.length}
            </span>
            {filtered && (
              <button type="button" className="import-reset" onClick={resetFilters}>
                Resetează filtre
              </button>
            )}
          </div>

          <div className="import-issue-list">
            {issues.length === 0 ? (
              <p className="hint-text import-empty">
                <CheckCircle2 size={16} /> Nimic pe filtrele curente.
              </p>
            ) : (
              issues.map((i, idx) => {
                const title = streetOf(i) || CODE_LABEL[i.code];
                return (
                  <article key={`${i.code}-${idx}`} className={`import-issue sev-${i.severity}`}>
                    <div className="import-issue-top">
                      <span className={`import-pill sev-${i.severity}`}>{i.severity}</span>
                      <span className="import-issue-type">{CODE_LABEL[i.code]}</span>
                    </div>
                    <h3 className="import-issue-title">{title}</h3>
                    <p className="import-detail">{i.detail}</p>
                    {(i.neighborhood_slug || i.csv_name || i.osm_name || i.osm_id != null) && (
                      <div className="import-chips">
                        {i.neighborhood_slug && <span>cartier {i.neighborhood_slug}</span>}
                        {i.csv_name && <span>csv {i.csv_name}</span>}
                        {i.osm_name && i.osm_name !== i.csv_name && <span>osm {i.osm_name}</span>}
                        {i.osm_id != null && <span>id {String(i.osm_id)}</span>}
                      </div>
                    )}
                    {i.hint && (
                      <details className="import-hint-fold">
                        <summary>Cum repari</summary>
                        <p>{i.hint}</p>
                      </details>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
