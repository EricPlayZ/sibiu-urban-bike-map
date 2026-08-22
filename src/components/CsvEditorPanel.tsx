import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Plus,
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
  emptyCsvRow,
  fetchMeasurementTables,
  persistMeasurementCsvFiles,
  serializeDirtyCsvTables,
  type CsvEditorRow,
  type CsvEditorTable,
} from "../lib/csvFiles";
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
  const close = useApp((s) => s.closeCsvEditor);
  const neighborhoodList = useApp((s) => s.neighborhoodList);
  const showToast = useApp((s) => s.showToast);
  const reloadPipeline = useApp((s) => s.reloadPipeline);

  const [tables, setTables] = useState<CsvEditorTable[] | null>(null);
  const [saved, setSaved] = useState<CsvEditorTable[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState<string>("");
  const [query, setQuery] = useState("");
  const [onlyMismatches, setOnlyMismatches] = useState(false);

  const loadTables = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await fetchMeasurementTables();
      setTables(next);
      setSaved(cloneCsvTables(next));
      setSlug((cur) => (next.some((t) => t.slug === cur) ? cur : next[0]?.slug || ""));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Nu am putut încărca CSV-urile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (tables) return;
    void loadTables();
  }, [open, tables, loadTables]);

  const fileDirty = Boolean(tables && saved && csvTablesFileFingerprint(tables) !== csvTablesFileFingerprint(saved));
  const marksDirty = Boolean(
    tables &&
      saved &&
      JSON.stringify(tables.map((t) => t.rows.map((r) => r.mark))) !== JSON.stringify(saved.map((t) => t.rows.map((r) => r.mark)))
  );
  const dirty = fileDirty || marksDirty;

  useEffect(() => {
    if (!fileDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [fileDirty]);

  const neighborhoodName = (s: string) => neighborhoodList.find((n) => n.slug === s)?.name || s;

  const active = tables?.find((t) => t.slug === slug) || tables?.[0] || null;
  const nameCol = active ? csvColumnMap(active.headers).name : null;

  const mismatchCountBySlug = useMemo(() => {
    const out: Record<string, number> = {};
    if (!tables) return out;
    for (const t of tables) {
      let n = 0;
      for (const row of t.rows) {
        const flags = flagsFromRawRecord(t.headers, row.cells);
        if (!parkingMarkMatchesFlags(row.mark, flags)) n++;
      }
      out[t.slug] = n;
    }
    return out;
  }, [tables]);

  const visibleRows = useMemo(() => {
    if (!active) return [];
    const q = query.trim().toLowerCase();
    return active.rows.filter((row) => {
      const flags = flagsFromRawRecord(active.headers, row.cells);
      if (onlyMismatches && parkingMarkMatchesFlags(row.mark, flags)) return false;
      if (q && !nameOf(row, nameCol, active.headers).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [active, nameCol, onlyMismatches, query]);

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

  const addRow = () => {
    if (!active) return;
    patchTable(active.slug, (t) => ({ ...t, rows: [...t.rows, emptyCsvRow(t.headers)] }));
  };

  const deleteRow = (rowId: string) => {
    if (!active) return;
    const row = active.rows.find((r) => r.id === rowId);
    const label = row ? nameOf(row, nameCol, active.headers) || "rândul gol" : "rândul";
    if (!window.confirm(`Ștergi „${label}” din ${neighborhoodName(active.slug)}?`)) return;
    patchTable(active.slug, (t) => ({ ...t, rows: t.rows.filter((r) => r.id !== rowId) }));
  };

  const discard = () => {
    if (!saved) return;
    if (!dirty) return;
    if (!window.confirm("Renunți la modificările din editor? CSV-urile de pe disk rămân neschimbate.")) return;
    setTables(cloneCsvTables(saved));
    showToast("Modificări anulate");
  };

  const save = async () => {
    if (!tables || !saved || !fileDirty) return;
    setSaving(true);
    const ok = await persistMeasurementCsvFiles(serializeDirtyCsvTables(tables, saved));
    setSaving(false);
    if (!ok) {
      showToast("Salvarea CSV a eșuat — rulează `npm run dev`");
      return;
    }
    setSaved(cloneCsvTables(tables));
    showToast("CSV salvat pe disk");
    await reloadPipeline();
  };

  if (!import.meta.env.DEV) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <button type="button" className="scrim csv-editor-scrim" onClick={close} aria-label="Închide editorul CSV" />
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
                  Măsurători CSV
                  <span className="csv-dev-badge">dev</span>
                </h2>
                <p className="sub">
                  Flag-urile se citesc din lățimi (parcare vs. zonă liberă trotuar), nu se editează. Galben = ilegal pe
                  trotuar, roșu = amenajată pe trotuar — ca să vezi dacă numerele spun același lucru.
                </p>
              </div>
              <button type="button" className="icon-x" onClick={close} aria-label="Închide">
                <X size={18} strokeWidth={2.25} />
              </button>
            </div>

            <div className="csv-editor-toolbar">
              <div className="csv-editor-actions">
                <button type="button" className="btn primary csv-editor-btn" onClick={() => void save()} disabled={!fileDirty || saving}>
                  <Save size={16} strokeWidth={2.25} />
                  {saving ? "Se salvează…" : "Salvează"}
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
                      <small>{t.rows.length}</small>
                      {mismatches > 0 ? <span className="csv-mismatch-count">{mismatches}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="csv-editor-body">
              {loading && <p className="hint-text">Se încarcă tabelele…</p>}
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
                            Niciun rând. Adaugă unul sau schimbă filtrul.
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
                            onDelete={deleteRow}
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
                <button type="button" className="btn csv-editor-btn" onClick={addRow}>
                  <Plus size={16} strokeWidth={2.25} />
                  Adaugă rând
                </button>
                <p className="hint-text tight">
                  {fileDirty ? "Modificări nesalvate în CSV." : "CSV-ul e la fel ca pe disk."}
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
  onDelete,
}: {
  row: CsvEditorRow;
  headers: string[];
  nameCol: string | null;
  onCell: (rowId: string, header: string, value: string) => void;
  onMark: (rowId: string, mark: ParkingMark) => void;
  onDelete: (rowId: string) => void;
}) {
  const flags = flagsFromRawRecord(headers, row.cells);
  const match = parkingMarkMatchesFlags(row.mark, flags);
  const chips = flagChips(flags);

  return (
    <tr className={`csv-row mark-${row.mark} ${match ? "match" : "mismatch"}`}>
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
          <input
            className="csv-cell"
            value={row.cells[h] ?? ""}
            onChange={(e) => onCell(row.id, h, e.target.value)}
            inputMode={nameCol === h ? "text" : "decimal"}
            aria-label={`${shortHeader(h)} — ${nameOf(row, nameCol, headers) || "rând nou"}`}
          />
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
        <button type="button" className="icon-mini danger" title="Șterge rândul" aria-label="Șterge rândul" onClick={() => onDelete(row.id)}>
          <Trash2 size={15} strokeWidth={2.25} />
        </button>
      </td>
    </tr>
  );
}
