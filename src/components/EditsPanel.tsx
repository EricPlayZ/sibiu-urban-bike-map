import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bike,
  Building2,
  Car,
  Download,
  Footprints,
  LocateFixed,
  ParkingSquare,
  Pencil,
  Road,
  Route,
  Ruler,
  Scissors,
  Trees,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import { useApp } from "../store";
import { panelSpring, springExit } from "../lib/uiMotion";
import { hasMeaningfulLocalEdit } from "../lib/space";
import { buildingTypeMeta, coerceBuildingType, inferBuildingTypeFromOsm } from "../lib/buildingTypes";
import {
  buildEditBundle,
  classifyEditBundle,
  formatEditDiff,
  parseEditBundle,
  streetMeasurementDiffs,
  type EditBundle,
  type EditBundleServer,
  type ImportReviewRow,
} from "../lib/editBundle";
import { editMapHit, featureWithProp, splitRootFeature, streetFeatureForFocus } from "../lib/editFocus";
import type { SearchHit } from "../lib/mapSearch";
import { parseStreetFixesFile } from "../lib/streetFixes";
import { rootSid } from "../lib/streetSplits";
import { fetchLiveEdits } from "../lib/teamApi";
import { EditReviewDialog } from "./EditReviewDialog";
import { Tip } from "./Tip";

type Tab = "streets" | "buildings" | "splits";

function groupByName<T>(items: T[], nameOf: (item: T) => string): { name: string; items: T[] }[] {
  const out: { name: string; items: T[] }[] = [];
  const index = new Map<string, number>();
  for (const item of items) {
    const name = nameOf(item);
    const at = index.get(name);
    if (at == null) {
      index.set(name, out.length);
      out.push({ name, items: [item] });
    } else out[at].items.push(item);
  }
  return out;
}

function foldLabel(label: string) {
  return label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function DiffIcon({ label }: { label: string }) {
  const n = foldLabel(label);
  const Icon = n.startsWith("nume")
    ? Type
    : n.startsWith("lungime")
      ? Ruler
      : n.startsWith("trama")
        ? Road
        : n.startsWith("carosabil")
          ? Car
          : n.includes("trotuar")
            ? Footprints
            : n.startsWith("pista")
              ? Bike
              : n.startsWith("verde")
                ? Trees
                : n.includes("parcare")
                  ? ParkingSquare
                  : n.startsWith("segment")
                    ? Scissors
                    : n.startsWith("tip")
                      ? Building2
                      : Pencil;
  return <Icon size={14} strokeWidth={2.25} aria-hidden />;
}

function DiffLine({ label, text }: { label: string; text: string }) {
  return (
    <li>
      <DiffIcon label={label} />
      <span>{text}</span>
    </li>
  );
}

function GoToMapButton({ onClick }: { onClick: () => void }) {
  return (
    <Tip text="Arată pe hartă">
      <button type="button" className="icon-mini" aria-label="Arată pe hartă" onClick={onClick}>
        <LocateFixed size={15} strokeWidth={2.25} aria-hidden />
      </button>
    </Tip>
  );
}

function SectionHead({
  count,
  label,
  onPurge,
}: {
  count: string;
  label: string;
  onPurge: () => void;
}) {
  return (
    <div className="edits-head">
      <span className="edits-count">{count}</span>
      <button type="button" className="btn danger-ghost" onClick={onPurge}>
        {label}
      </button>
    </div>
  );
}

function EditCard({
  selected,
  children,
  actions,
}: {
  selected: boolean;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className={`edit-card${selected ? " is-selected" : ""}`}>
      <div className="edit-card-main">{children}</div>
      <div className="edits-actions">{actions}</div>
    </div>
  );
}

export function EditsPanel() {
  const open = useApp((s) => s.editsOpen);
  const teamAuthed = useApp((s) => s.teamAuthed);
  const committedEdits = useApp((s) => s.committedEdits);
  const seedMeasurements = useApp((s) => s.seedMeasurements);
  const buildingTypes = useApp((s) => s.buildingTypes);
  const buildings = useApp((s) => s.buildings);
  const streetSplits = useApp((s) => s.streetSplits);
  const pipelineStreetsRaw = useApp((s) => s.pipelineStreetsRaw);
  const streets = useApp((s) => s.streets);
  const searchFocus = useApp((s) => s.searchFocus);
  const focusEditsHit = useApp((s) => s.focusEditsHit);
  const closeEdits = useApp((s) => s.closeEdits);
  const openStreetEdit = useApp((s) => s.openStreetEdit);
  const deleteStreetEdit = useApp((s) => s.deleteStreetEdit);
  const purgeAllStreetEdits = useApp((s) => s.purgeAllStreetEdits);
  const purgeAllBuildingEdits = useApp((s) => s.purgeAllBuildingEdits);
  const purgeAllSplitEdits = useApp((s) => s.purgeAllSplitEdits);
  const deleteBuildingEdit = useApp((s) => s.deleteBuildingEdit);
  const clearSplitEdit = useApp((s) => s.clearSplitEdit);
  const showToast = useApp((s) => s.showToast);

  const [tab, setTab] = useState<Tab>("streets");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBundle, setReviewBundle] = useState<EditBundle | null>(null);
  const [reviewServer, setReviewServer] = useState<EditBundleServer | null>(null);
  const [reviewRows, setReviewRows] = useState<ImportReviewRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const focusToken = useRef<number | null>(null);
  const highlightedId = searchFocus?.hit.id ?? null;
  const featureIsHighlighted = (key: string, prop: "sid" | "bid", id: string) => {
    if (highlightedId === `edit:${key}`) return true;
    return Boolean(
      searchFocus?.hit.features.some((f) => String((f.properties as Record<string, unknown> | null)?.[prop] || "") === id),
    );
  };

  useEffect(() => {
    const release = () => {
      const token = focusToken.current;
      focusToken.current = null;
      const st = useApp.getState();
      if (token != null && st.searchFocus?.token === token) st.clearSearchFocus();
    };
    if (!open) {
      release();
      return;
    }
    return release;
  }, [open]);

  const streetRows = Object.entries(committedEdits).filter(([, m]) => hasMeaningfulLocalEdit(m));
  const buildingRows = Object.entries(buildingTypes);
  const splitRows = Object.entries(streetSplits).filter(([, pts]) => pts.length > 0);

  const streetName = (id: string) => {
    const root = rootSid(id);
    const f =
      featureWithProp(pipelineStreetsRaw, "sid", id) ||
      featureWithProp(pipelineStreetsRaw, "sid", root) ||
      featureWithProp(streets, "sid", id);
    const p = (f?.properties || {}) as { name?: string };
    return String(p.name || committedEdits[id]?.name || committedEdits[root]?.name || id);
  };

  const focusEdit = (key: string, hit: SearchHit | null) => {
    if (!hit) {
      showToast("Nu găsesc geometria");
      return;
    }
    focusToken.current = focusEditsHit(hit);
  };

  const clearHighlight = (match: (id: string) => boolean) => {
    const st = useApp.getState();
    const id = st.searchFocus?.hit.id;
    if (!id || !match(id)) return;
    if (focusToken.current != null && st.searchFocus?.token === focusToken.current) focusToken.current = null;
    st.clearSearchFocus();
  };

  const buildingLabel = (id: string) => {
    const f = buildings?.features.find((x) => String((x.properties as { bid?: string })?.bid) === id);
    const osm = String((f?.properties as { building?: string })?.building || "");
    const prev = inferBuildingTypeFromOsm(osm);
    const curr = coerceBuildingType(buildingTypes[id]?.type);
    return { prev: buildingTypeMeta(prev).label, curr: buildingTypeMeta(curr).label, osm };
  };

  const exportBundle = async () => {
    let streetFixes = null;
    try {
      const r = await fetch("./data/street-fixes.json", { cache: "no-store" });
      if (r.ok) streetFixes = parseStreetFixesFile(await r.json());
    } catch {
      /* optional */
    }
    const bundle = buildEditBundle({
      streets: committedEdits,
      buildings: Object.fromEntries(buildingRows.map(([id, v]) => [id, v.type])),
      splits: streetSplits,
      streetFixes,
    });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sibiu-urban-bike-edits.json";
    a.click();
    showToast("Bundle exportat");
  };

  const onPickImport = () => fileRef.current?.click();

  const onImportFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const parsed = parseEditBundle(raw);
      if (!parsed.ok) {
        showToast(parsed.reason);
        return;
      }
      const live = await fetchLiveEdits();
      const server: EditBundleServer = {
        streets: live.streets,
        buildings: Object.fromEntries(Object.entries(live.buildings.edits).map(([id, v]) => [id, v.type])),
        splits: live.splits.splits,
        buildingsUpdatedAt: live.buildings.updated_at,
        splitsUpdatedAt: live.splits.updated_at,
        streetFixes: null,
      };
      setReviewBundle(parsed.bundle);
      setReviewServer(server);
      setReviewRows(classifyEditBundle(parsed.bundle, server));
      setReviewOpen(true);
    } catch {
      showToast("Fișier JSON invalid");
    }
  };

  if (!teamAuthed) return null;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onImportFile(f);
        }}
      />
      <EditReviewDialog
        open={reviewOpen && Boolean(reviewBundle && reviewServer)}
        bundle={reviewBundle!}
        server={reviewServer!}
        rows={reviewRows}
        onRowsChange={setReviewRows}
        onClose={() => setReviewOpen(false)}
        onDone={() => {
          setReviewOpen(false);
          setReviewBundle(null);
        }}
      />
      <AnimatePresence>
        {open && (
          <motion.aside
            className="panel edits-panel"
            initial={{ x: 28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={springExit({ x: 20, opacity: 0 })}
            transition={panelSpring}
          >
            <div className="panel-head">
              <h2>Editări salvate</h2>
              <Tip text="Închide">
                <button type="button" className="icon-x" onClick={closeEdits} aria-label="Închide">
                  <X size={18} strokeWidth={2.25} />
                </button>
              </Tip>
            </div>

            <div className="edits-toolbar">
              <button type="button" className="btn" onClick={() => void exportBundle()}>
                <Download size={15} /> Export
              </button>
              <button type="button" className="btn" onClick={onPickImport}>
                <Upload size={15} /> Import
              </button>
            </div>

            <div className="seg edits-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "streets"} className={tab === "streets" ? "on" : ""} onClick={() => setTab("streets")}>
                <Route size={14} strokeWidth={2.25} aria-hidden />
                <span>Străzi</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === "buildings"} className={tab === "buildings" ? "on" : ""} onClick={() => setTab("buildings")}>
                <Building2 size={14} strokeWidth={2.25} aria-hidden />
                <span>Clădiri</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === "splits"} className={tab === "splits" ? "on" : ""} onClick={() => setTab("splits")}>
                <Scissors size={14} strokeWidth={2.25} aria-hidden />
                <span>Segmentări</span>
              </button>
            </div>

            {tab === "streets" ? (
              streetRows.length === 0 ? (
                <p className="hint-text">Nu există editări de străzi salvate.</p>
              ) : (
                <>
                  <SectionHead
                    count={`${streetRows.length} străzi`}
                    label="Șterge tot (străzi)"
                    onPurge={() => {
                      if (!window.confirm(`Ștergi toate cele ${streetRows.length} editări de străzi de pe server?`)) return;
                      clearHighlight((id) => id.startsWith("edit:street:"));
                      void purgeAllStreetEdits();
                    }}
                  />
                  <div className="edits-list">
                    {groupByName(streetRows, ([id]) => streetName(id)).map((group) => (
                      <section key={group.name} className="edits-group">
                        <h3 className="edits-group-title">{group.name}</h3>
                        {group.items.map(([id, m]) => {
                          const key = `street:${id}`;
                          const exact = featureWithProp(streets, "sid", id) || featureWithProp(pipelineStreetsRaw, "sid", id);
                          const props = (exact?.properties || {}) as Record<string, unknown>;
                          const diffs = streetMeasurementDiffs(id, props, m, committedEdits, seedMeasurements);
                          return (
                            <EditCard
                              key={id}
                              selected={featureIsHighlighted(key, "sid", id)}
                              actions={
                                <>
                                  <GoToMapButton
                                    onClick={() => focusEdit(key, editMapHit(key, group.name, "Stradă", streetFeatureForFocus(streets, pipelineStreetsRaw, id)))}
                                  />
                                  <Tip text="Editează">
                                    <button type="button" className="icon-mini" aria-label="Editează" onClick={() => openStreetEdit(id)}>
                                      <Pencil size={15} strokeWidth={2.25} />
                                    </button>
                                  </Tip>
                                  <Tip text="Șterge">
                                    <button
                                      type="button"
                                      className="icon-mini danger"
                                      aria-label="Șterge"
                                      onClick={() => {
                                        if (!window.confirm(`Ștergi editarea pentru „${streetName(id)}”?`)) return;
                                        clearHighlight((hid) => hid === `edit:${key}`);
                                        void deleteStreetEdit(id);
                                      }}
                                    >
                                      <Trash2 size={15} strokeWidth={2.25} />
                                    </button>
                                  </Tip>
                                </>
                              }
                            >
                              <ul className="edit-diffs">
                                {diffs.length === 0 ? (
                                  <DiffLine label="Editare" text="Editare salvată" />
                                ) : (
                                  diffs.map((d) => <DiffLine key={d.label} label={d.label} text={formatEditDiff(d)} />)
                                )}
                              </ul>
                            </EditCard>
                          );
                        })}
                      </section>
                    ))}
                  </div>
                </>
              )
            ) : null}

            {tab === "buildings" ? (
              buildingRows.length === 0 ? (
                <p className="hint-text">Nu există tipuri de clădiri salvate.</p>
              ) : (
                <>
                  <SectionHead
                    count={`${buildingRows.length} clădiri`}
                    label="Șterge tot (clădiri)"
                    onPurge={() => {
                      if (!window.confirm(`Ștergi toate cele ${buildingRows.length} tipuri de clădiri de pe server?`)) return;
                      clearHighlight((id) => id.startsWith("edit:building:"));
                      void purgeAllBuildingEdits();
                    }}
                  />
                  <div className="edits-list">
                  {buildingRows.map(([id]) => {
                    const key = `building:${id}`;
                    const { prev, curr } = buildingLabel(id);
                    const line = prev === curr ? `Tip: ${curr}` : `Tip: ${prev} → ${curr}`;
                    return (
                      <EditCard
                        key={id}
                        selected={featureIsHighlighted(key, "bid", id)}
                        actions={
                          <>
                            <GoToMapButton
                              onClick={() =>
                                focusEdit(key, editMapHit(key, `Clădire · ${curr}`, "Clădire", featureWithProp(buildings, "bid", id)))
                              }
                            />
                            <Tip text="Șterge">
                              <button
                                type="button"
                                className="icon-mini danger"
                                aria-label="Șterge"
                                onClick={() => {
                                  if (!window.confirm("Scoți tipul salvat pentru această clădire?")) return;
                                  clearHighlight((hid) => hid === `edit:${key}`);
                                  void deleteBuildingEdit(id);
                                }}
                              >
                                <Trash2 size={15} strokeWidth={2.25} />
                              </button>
                            </Tip>
                          </>
                        }
                      >
                        <div className="edit-card-title">Clădire</div>
                        <ul className="edit-diffs">
                          <DiffLine label="Tip" text={line} />
                        </ul>
                        <span className="edits-sid">{id}</span>
                      </EditCard>
                    );
                  })}
                  </div>
                </>
              )
            ) : null}

            {tab === "splits" ? (
              splitRows.length === 0 ? (
                <p className="hint-text">Nu există străzi segmentate.</p>
              ) : (
                <>
                  <SectionHead
                    count={`${splitRows.length} segmentări`}
                    label="Șterge tot (segmentări)"
                    onPurge={() => {
                      if (!window.confirm(`Scoți toate cele ${splitRows.length} segmentări? Măsurătorile bucăților tăiate se șterg.`)) return;
                      clearHighlight((id) => id.startsWith("edit:split:"));
                      void purgeAllSplitEdits();
                    }}
                  />
                  <div className="edits-list">
                  {groupByName(splitRows, ([root]) => streetName(root)).map((group) => (
                    <section key={group.name} className="edits-group">
                      <h3 className="edits-group-title">{group.name}</h3>
                      {group.items.map(([root, pts]) => {
                        const key = `split:${root}`;
                        return (
                          <EditCard
                            key={root}
                            selected={featureIsHighlighted(key, "sid", root)}
                            actions={
                              <>
                                <GoToMapButton
                                  onClick={() =>
                                    focusEdit(key, editMapHit(key, group.name, "Segmentare", splitRootFeature(streets, pipelineStreetsRaw, root)))
                                  }
                                />
                                <Tip text="Scoate segmentarea">
                                  <button
                                    type="button"
                                    className="icon-mini danger"
                                    aria-label="Scoate segmentarea"
                                    onClick={() => {
                                      if (!window.confirm("Scoți segmentarea? Măsurătorile bucăților tăiate se șterg.")) return;
                                      clearHighlight((hid) => hid === `edit:${key}`);
                                      void clearSplitEdit(root);
                                    }}
                                  >
                                    <Trash2 size={15} strokeWidth={2.25} />
                                  </button>
                                </Tip>
                              </>
                            }
                          >
                            <ul className="edit-diffs">
                              <DiffLine label="Segmentare" text={`Segmentare: nesegmentată → ${pts.length} puncte de tăiere`} />
                            </ul>
                          </EditCard>
                        );
                      })}
                    </section>
                    ))}
                  </div>
                </>
              )
            ) : null}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
