import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  RotateCcw,
  Save,
  Search,
  Table2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  csvColumnMap,
  flagsFromRawRecord,
  isParkingFlagHeader,
  normHeader,
  parkingMarkMatchesFlags,
  type DerivedFlags,
  type ParkingMark,
} from "../lib/csvImport";
import {
  cloneCsvTables,
  csvTablesFileFingerprint,
  editorRowToFixable,
  fetchSheetEditorTables,
  persistStreetFixesFile,
  tablesToRecordsBySlug,
  type CsvEditorRow,
  type CsvEditorTable,
} from "../lib/csvFiles";
import { deriveStreetFixes, recordsHaveFix, type FixDrift, type StreetFixesFile } from "../lib/streetFixes";
import { acquireLock, releaseLock } from "../lib/teamApi";
import { LAYER_COLORS } from "../lib/space";
import { useApp } from "../store";

const HEADER_SHORT: Record<string, string> = {
  nume: "Nume",
  name: "Nume",
  "latime trama stradala": "Tramă",
  "latime carosabil": "Carosabil",
  "latime trotuar 1": "Trotuar 1",
  "latime trotuar 2": "Trotuar 2",
  "latime parcare 1": "Parcare 1",
  "latime parcare 2": "Parcare 2",
  "zona libera trotuar 1": "Liber 1",
  "zona libera trotuar 2": "Liber 2",
  "latime pista biciclete 1": "Pistă 1",
  "latime pista biciclete 2": "Pistă 2",
  "zona verde 1": "Verde 1",
  "zona verde 2": "Verde 2",
  "zona verde intre benzi": "Verde benzi",
};

function shortHeader(h: string) {
  return HEADER_SHORT[normHeader(h)] || h;
}

function flagChips(flags: DerivedFlags) {
  const chips: { id: string; label: string; color: string }[] = [];
  if (flags.illgl_park) chips.push({ id: "illegal", label: "Ilegal pe trotuar", color: LAYER_COLORS.illegal });
  if (flags.rsrvd_park) chips.push({ id: "reserved", label: "Amenajată pe trotuar", color: LAYER_COLORS.reserved });
  if (flags.bike_door) chips.push({ id: "door", label: "Pistă pe carosabil", color: LAYER_COLORS.bikeDoor });
  else if (flags.bike_lane) chips.push({ id: "bike", label: "Pistă", color: LAYER_COLORS.bike });
  if (flags.has_green) chips.push({ id: "green", label: "Verde", color: "#2f9e44" });
  return chips;
}

function nameOf(row: CsvEditorRow, nameCol: string | null, headers: string[]) {
  if (nameCol) return String(row.cells[nameCol] || "");
  return String(row.cells[headers[0]] || "");
}

export function CsvEditorPanel() {
  const open = useApp((s) => s.csvEditorOpen);
  const closeStore = useApp((s) => s.closeCsvEditor);
  const neighborhoodList = useApp((s) => s.neighborhoodList);
  const showToast = useApp((s) => s.showToast);
  const reloadPipeline = useApp((s) => s.reloadPipeline);

  const [tables, setTables] = useState<CsvEditorTable[] | null>(null);
  const [saved, setSaved] = useState<CsvEditorTable[] | null>(null);
  const [savedFixes, setSavedFixes] = useState<StreetFixesFile | null>(null);
  const [drift, setDrift] = useState<FixDrift[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState<string>("");
  const [query, setQuery] = useState("");
  const [onlyMismatches, setOnlyMismatches] = useState(false);
  const [onlyFixes, setOnlyFixes] = useState(false);
  const [onlyOmitted, setOnlyOmitted] = useState(false);
  const [sheetsHolder, setSheetsHolder] = useState<string | null>(null);

  const fileDirty = Boolean(tables && saved && csvTablesFileFingerprint(tables) !== csvTablesFileFingerprint(saved));
  const marksDirty = Boolean(
    tables &&
      saved &&
      JSON.stringify(tables.map((t) => t.rows.map((r) => r.mark))) !== JSON.stringify(saved.map((t) => t.rows.map((r) => r.mark)))
  );
  const dirty = fileDirty || marksDirty;

  const loadTables = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await fetchSheetEditorTables();
      setTables(next.tables);
      setSaved(cloneCsvTables(next.tables));
      setSavedFixes(next.fixes);
      setDrift(next.drift);
      setSlug((cur) => (next.tables.some((t) => t.slug === cur) ? cur : next.tables[0]?.slug || ""));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Nu am putut încărca spreadsheet-ul.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (tables && fileDirty) return;
    void loadTables();
    // fileDirty / tables intentionally omitted: reload on each open unless unsaved edits exist
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadTables]);

  useEffect(() => {
    if (!open) {
      setSheetsHolder(null);
      return;
    }
    let stop = false;
    const beat = async () => {
      const r = await acquireLock("sheets");
      if (stop) {
        await releaseLock("sheets");
        return;
      }
      setSheetsHolder(r.ok ? null : r.holder);
    };
    void beat();
    const t = window.setInterval(() => void beat(), 20_000);
    return () => {
      stop = true;
      window.clearInterval(t);
      void releaseLock("sheets");
    };
  }, [open]);

  useEffect(() => {
    if (!fileDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [fileDirty]);

  const requestClose = () => {
    if (fileDirty && !window.confirm("Ai modificări nesalvate în corecții. Închizi oricum?")) return;
    closeStore();
  };

  const neighborhoodName = (s: string) => neighborhoodList.find((n) => n.slug === s)?.name || s;

  const active = tables?.find((t) => t.slug === slug) || tables?.[0] || null;
  const nameCol = active ? csvColumnMap(active.headers).name : null;

  const mismatchCountBySlug = useMemo(() => {
    const out: Record<string, number> = {};
    if (!tables) return out;
    for (const t of tables) {
      let n = 0;
      for (const row of t.rows) {
        if (row.omitted) continue;
        const flags = flagsFromRawRecord(t.headers, row.cells);
        if (!parkingMarkMatchesFlags(row.mark, flags)) n++;
      }
      out[t.slug] = n;
    }
    return out;
  }, [tables]);

  const fixCountBySlug = useMemo(() => {
    const out: Record<string, number> = {};
    if (!tables) return out;
    for (const t of tables) {
      out[t.slug] = t.rows.filter((r) => recordsHaveFix(editorRowToFixable(r))).length;
    }
    return out;
  }, [tables]);

  const visibleRows = useMemo(() => {
    if (!active) return [];
    const q = query.trim().toLowerCase();
    return active.rows.filter((row) => {
      const flags = flagsFromRawRecord(active.headers, row.cells);
      if (onlyOmitted && !row.omitted) return false;
      if (onlyFixes && !recordsHaveFix(editorRowToFixable(row))) return false;
      if (onlyMismatches && (row.omitted || parkingMarkMatchesFlags(row.mark, flags))) return false;
      const label = `${nameOf(row, nameCol, active.headers)} ${row.sheetName} ${row.uniqueKey}`;
      if (q && !label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [active, nameCol, onlyFixes, onlyMismatches, onlyOmitted, query]);

  const patchTable = (slugToPatch: string, fn: (t: CsvEditorTable) => CsvEditorTable) => {
    setTables((prev) => (prev ? prev.map((t) => (t.slug === slugToPatch ? fn(t) : t)) : prev));
  };

  const setCell = (rowId: string, header: string, value: string) => {
    if (!active) return;
    patchTable(active.slug, (t) => ({
      ...t,
      rows: t.rows.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [header]: value } } : r)),
    }));
  };

  const setMark = (rowId: string, mark: ParkingMark) => {
    if (!active) return;
    patchTable(active.slug, (t) => ({
      ...t,
      rows: t.rows.map((r) => (r.id === rowId ? { ...r, mark } : r)),
    }));
  };

  const omitRow = (rowId: string) => {
    if (!active) return;
    const row = active.rows.find((r) => r.id === rowId);
    const label = row ? nameOf(row, nameCol, active.headers) || row.sheetName : "rândul";
    if (!window.confirm(`Omiți „${label}” din ${neighborhoodName(active.slug)}? Rămâne în spreadsheet, dar nu ajunge pe hartă.`)) return;
    patchTable(active.slug, (t) => ({
      ...t,
      rows: t.rows.map((r) => (r.id === rowId ? { ...r, omitted: true } : r)),
    }));
  };

  const restoreRow = (rowId: string) => {
    if (!active) return;
    patchTable(active.slug, (t) => ({
      ...t,
      rows: t.rows.map((r) => (r.id === rowId ? { ...r, omitted: false } : r)),
    }));
  };

  const discard = () => {
    if (!saved) return;
    if (!dirty) return;
    if (!window.confirm("Renunți la modificările din editor? street-fixes.json rămâne neschimbat.")) return;
    setTables(cloneCsvTables(saved));
    showToast("Modificări anulate");
  };

  const save = async () => {
    if (!tables || !savedFixes || !fileDirty || sheetsHolder) return;
    setSaving(true);
    const next = deriveStreetFixes(tablesToRecordsBySlug(tables), savedFixes);
    const saved = await persistStreetFixesFile(next, savedFixes.updated_at);
    setSaving(false);
    if (!saved) {
      showToast("Salvarea corecțiilor a eșuat — ești autentificat?");
      return;
    }
    setSaved(cloneCsvTables(tables));
    setSavedFixes(saved);
    setDrift([]);
    showToast("Corecții salvate în street-fixes.json");
    await reloadPipeline();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <button type="button" className="scrim csv-editor-scrim" onClick={requestClose} aria-label="Închide editorul de măsurători" />
          <motion.aside
            className="panel csv-editor-panel"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12, pointerEvents: "none" }}
            transition={{ type: "spring", stiffness: 360, damping: 32 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="csv-editor-title"
          >
            <div className="panel-head csv-editor-head">
              <div>
                <h2 id="csv-editor-title">
                  <Table2 size={18} strokeWidth={2.25} aria-hidden />
                  Măsurători spreadsheet
                </h2>
                <p className="sub">
                  Valorile sunt din Google Sheets, cu corecțiile din street-fixes.json deja aplicate. Rename / lățimi /
                  omit se salvează acolo — nu în CSV. Flag-urile se citesc din lățimi.
                </p>
              </div>
              <button type="button" className="icon-x" onClick={requestClose} aria-label="Închide">
                <X size={18} strokeWidth={2.25} />
              </button>
            </div>

            {sheetsHolder ? (
              <p className="csv-drift-banner" role="status">
                {sheetsHolder} editează măsurătorile. Salvează e blocat până eliberează editorul.
              </p>
            ) : null}

            {drift.length > 0 ? (
              <p className="csv-drift-banner" role="status">
                <AlertTriangle size={15} strokeWidth={2.25} aria-hidden />
                {drift.length === 1
                  ? drift[0].detail
                  : `${drift.length} corecții nu mai coincid cu spreadsheet-ul (vezi raportul de import, coduri sheets_fix_stale / sheets_fix_orphan).`}
              </p>
            ) : null}

            <div className="csv-editor-toolbar">
              <div className="csv-editor-actions">
                <button type="button" className="btn primary csv-editor-btn" onClick={() => void save()} disabled={!fileDirty || saving || Boolean(sheetsHolder)}>
                  <Save size={16} strokeWidth={2.25} />
                  {saving ? "Se salvează…" : "Salvează corecții"}
                </button>
                <button type="button" className="btn csv-editor-btn" onClick={discard} disabled={!dirty}>
                  <Undo2 size={16} strokeWidth={2.25} />
                  Renunță
                </button>
              </div>
              <label className="csv-editor-search">
                <Search size={15} strokeWidth={2.25} aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Caută stradă…"
                  aria-label="Caută stradă"
                />
              </label>
              <label className={`csv-mismatch-toggle ${onlyFixes ? "on" : ""}`}>
                <input type="checkbox" checked={onlyFixes} onChange={(e) => setOnlyFixes(e.target.checked)} />
                Doar corecții
              </label>
              <label className={`csv-mismatch-toggle ${onlyOmitted ? "on" : ""}`}>
                <input type="checkbox" checked={onlyOmitted} onChange={(e) => setOnlyOmitted(e.target.checked)} />
                Omise
              </label>
              <label className={`csv-mismatch-toggle ${onlyMismatches ? "on" : ""}`}>
                <input type="checkbox" checked={onlyMismatches} onChange={(e) => setOnlyMismatches(e.target.checked)} />
                Doar nepotriviri
              </label>
              <p className="csv-mark-legend">
                <span>
                  <span className="swatch none" /> nimic
                </span>
                <span>
                  <span className="swatch illegal" /> ilegal
                </span>
                <span>
                  <span className="swatch reserved" /> amenajată
                </span>
              </p>
            </div>

            {tables && tables.length > 0 && (
              <div className="csv-editor-tabs" role="tablist" aria-label="Cartiere">
                {tables.map((t) => {
                  const mismatches = mismatchCountBySlug[t.slug] || 0;
                  const fixes = fixCountBySlug[t.slug] || 0;
                  const live = t.rows.filter((r) => !r.omitted).length;
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      role="tab"
                      aria-selected={t.slug === active?.slug}
                      className={`csv-editor-tab ${t.slug === active?.slug ? "on" : ""}`}
                      onClick={() => setSlug(t.slug)}
                    >
                      <span>{neighborhoodName(t.slug)}</span>
                      <small>{live}</small>
                      {fixes > 0 ? <span className="csv-fix-count">{fixes}</span> : null}
                      {mismatches > 0 ? <span className="csv-mismatch-count">{mismatches}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="csv-editor-body">
              {loading && <p className="hint-text">Se încarcă spreadsheet-ul…</p>}
              {loadError && (
                <p className="hint-text">
                  {loadError}{" "}
                  <button type="button" className="import-reset" onClick={() => void loadTables()}>
                    Reîncearcă
                  </button>
                </p>
              )}
              {!loading && !loadError && active && (
                <div className="csv-table-wrap">
                  <table className="csv-table">
                    <thead>
                      <tr>
                        <th className="csv-col-mark">Marcaj</th>
                        {active.headers.map((h) => (
                          <th
                            key={h}
                            title={h}
                            className={
                              isParkingFlagHeader(h) ? "csv-col-flag-src" : nameCol === h ? "csv-col-name" : undefined
                            }
                          >
                            {shortHeader(h)}
                          </th>
                        ))}
                        <th className="csv-col-flags">Flag-uri din lățimi</th>
                        <th className="csv-col-del"> </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.length === 0 ? (
                        <tr>
                          <td colSpan={active.headers.length + 3} className="csv-empty">
                            Niciun rând. Schimbă filtrul sau așteaptă date în spreadsheet.
                          </td>
                        </tr>
                      ) : (
                        visibleRows.map((row) => (
                          <CsvEditorRowView
                            key={row.id}
                            row={row}
                            headers={active.headers}
                            nameCol={nameCol}
                            onCell={setCell}
                            onMark={setMark}
                            onOmit={omitRow}
                            onRestore={restoreRow}
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {active && (
              <div className="csv-editor-foot">
                <p className="hint-text tight">
                  {fileDirty ? "Modificări nesalvate în street-fixes.json." : "Corecțiile coincid cu fișierul de pe disk."}
                  {marksDirty ? " Marcajele sunt doar în editor, nu se scriu în fișier." : ""}
                </p>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function CsvEditorRowView({
  row,
  headers,
  nameCol,
  onCell,
  onMark,
  onOmit,
  onRestore,
}: {
  row: CsvEditorRow;
  headers: string[];
  nameCol: string | null;
  onCell: (rowId: string, header: string, value: string) => void;
  onMark: (rowId: string, mark: ParkingMark) => void;
  onOmit: (rowId: string) => void;
  onRestore: (rowId: string) => void;
}) {
  const flags = flagsFromRawRecord(headers, row.cells);
  const match = parkingMarkMatchesFlags(row.mark, flags);
  const chips = flagChips(flags);
  const display = nameOf(row, nameCol, headers);
  const renamed = display.trim() !== row.sheetName;
  const widthOnly = Boolean(
    recordsHaveFix({
      uniqueKey: row.uniqueKey,
      baseKey: row.baseKey,
      sheetName: row.sheetName,
      displayName: row.sheetName,
      sheetCells: row.sheetCells,
      cells: { ...row.cells, Nume: row.sheetName },
      omitted: false,
    })
  );

  return (
    <tr className={`csv-row mark-${row.mark} ${match ? "match" : "mismatch"} ${row.omitted ? "omitted" : ""}`}>
      <td className="csv-col-mark">
        <div className="csv-mark-seg" role="group" aria-label="Marcaj așteptat">
          <button
            type="button"
            className={row.mark === "none" ? "on" : ""}
            title="Fără parcare pe trotuar"
            aria-pressed={row.mark === "none"}
            onClick={() => onMark(row.id, "none")}
          >
            —
          </button>
          <button
            type="button"
            className={`mark-illegal ${row.mark === "illegal" ? "on" : ""}`}
            title="Așteptat: parcare ilegală pe trotuar"
            aria-pressed={row.mark === "illegal"}
            onClick={() => onMark(row.id, "illegal")}
          >
            I
          </button>
          <button
            type="button"
            className={`mark-reserved ${row.mark === "reserved" ? "on" : ""}`}
            title="Așteptat: parcare amenajată pe trotuar"
            aria-pressed={row.mark === "reserved"}
            onClick={() => onMark(row.id, "reserved")}
          >
            A
          </button>
        </div>
      </td>
      {headers.map((h) => (
        <td key={h} className={isParkingFlagHeader(h) ? "csv-col-flag-src" : nameCol === h ? "csv-col-name" : undefined}>
          {nameCol === h ? (
            <div className="csv-name-stack">
              <input
                className="csv-cell"
                value={row.cells[h] ?? ""}
                onChange={(e) => onCell(row.id, h, e.target.value)}
                disabled={row.omitted}
                aria-label={`Nume — ${display || row.sheetName}`}
              />
              <span className="csv-name-meta">
                {renamed ? <span title={`Nume în spreadsheet: ${row.sheetName}`}>sheet: {row.sheetName}</span> : null}
                {row.uniqueKey.includes("#") ? <span>#{row.uniqueKey.split("#")[1]}</span> : null}
                {row.omitted ? <span className="csv-fix-badge omit">omis</span> : null}
                {renamed ? <span className="csv-fix-badge rename">rename</span> : null}
                {widthOnly ? <span className="csv-fix-badge width">lățimi</span> : null}
              </span>
            </div>
          ) : (
            <input
              className="csv-cell"
              value={row.cells[h] ?? ""}
              onChange={(e) => onCell(row.id, h, e.target.value)}
              inputMode="decimal"
              disabled={row.omitted}
              aria-label={`${shortHeader(h)} — ${display || row.sheetName}`}
            />
          )}
        </td>
      ))}
      <td className="csv-col-flags">
        <div className="csv-flags">
          {match ? (
            <span className="csv-flag-status ok" title="Marcajul coincide cu flag-urile">
              <Check size={13} strokeWidth={2.5} />
            </span>
          ) : (
            <span className="csv-flag-status bad" title="Marcajul nu coincide cu flag-urile din lățimi">
              <AlertTriangle size={13} strokeWidth={2.5} />
            </span>
          )}
          {chips.length === 0 ? <span className="csv-flag-none">—</span> : null}
          {chips.map((c) => (
            <span key={c.id} className="csv-flag-chip" style={{ "--c": c.color } as CSSProperties}>
              {c.label}
            </span>
          ))}
        </div>
      </td>
      <td className="csv-col-del">
        {row.omitted ? (
          <button type="button" className="icon-mini" title="Reia strada" aria-label="Reia strada" onClick={() => onRestore(row.id)}>
            <RotateCcw size={15} strokeWidth={2.25} />
          </button>
        ) : (
          <button type="button" className="icon-mini danger" title="Omite strada" aria-label="Omite strada" onClick={() => onOmit(row.id)}>
            <Trash2 size={15} strokeWidth={2.25} />
          </button>
        )}
      </td>
    </tr>
  );
}
