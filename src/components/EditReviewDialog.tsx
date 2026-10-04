import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { EditBundle, EditBundleServer, ImportReviewRow } from "../lib/editBundle";
import { panelSpring, springExit } from "../lib/uiMotion";
import {
  ApiError,
  lockedHolder,
  putBuilding,
  putSplits,
  putStreet,
  putStreetFixes,
} from "../lib/teamApi";
import { planSplitChange } from "../lib/streetSplits";
import { splitImportRemovesPoints } from "../lib/editBundle";
import { isClassifiedBuildingType } from "../lib/buildingTypes";
import { useApp } from "../store";
import { Tip } from "./Tip";

type Props = {
  open: boolean;
  bundle: EditBundle;
  server: EditBundleServer;
  rows: ImportReviewRow[];
  onRowsChange: (rows: ImportReviewRow[]) => void;
  onClose: () => void;
  onDone: () => void;
};

export function EditReviewDialog({ open, bundle, server, rows, onRowsChange, onClose, onDone }: Props) {
  const [applying, setApplying] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const pipelineStreetsRaw = useApp((s) => s.pipelineStreetsRaw);
  const streetSplits = useApp((s) => s.streetSplits);
  const buildingsEditsUpdatedAt = useApp((s) => s.buildingsEditsUpdatedAt);
  const splitsEditsUpdatedAt = useApp((s) => s.splitsEditsUpdatedAt);
  const refreshLiveEdits = useApp((s) => s.refreshLiveEdits);

  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows]);

  const toggleRow = (id: string, kind: ImportReviewRow["kind"], on: boolean) => {
    onRowsChange(rows.map((r) => (r.id === id && r.kind === kind ? { ...r, selected: on } : r)));
  };

  const toggleForce = (id: string, kind: ImportReviewRow["kind"], on: boolean) => {
    onRowsChange(rows.map((r) => (r.id === id && r.kind === kind ? { ...r, forceOverwrite: on } : r)));
  };

  const apply = async () => {
    if (!selectedCount || applying) return;
    setApplying(true);
    setFailures([]);
    const failed: string[] = [];

    for (const row of rows) {
      if (!row.selected) continue;
      try {
        if (row.kind === "street" && row.street && row.state !== "same") {
          const srv = server.streets[row.id];
          const ifMatch = row.forceOverwrite ? "*" : srv?.updated_at;
          await putStreet(row.id, row.street, ifMatch);
        } else if (row.kind === "building" && row.buildingType && row.state !== "same") {
          if (!isClassifiedBuildingType(row.buildingType)) {
            failed.push(`${row.title}: tip invalid`);
            continue;
          }
          const ifMatch = row.forceOverwrite ? "*" : buildingsEditsUpdatedAt || undefined;
          await putBuilding(row.id, row.buildingType, ifMatch);
        } else if (row.kind === "split" && row.splitPoints && row.state !== "same") {
          const serverPts = server.splits[row.id] || [];
          if (splitImportRemovesPoints(serverPts, row.splitPoints)) {
            failed.push(`${row.title}: importul nu șterge segmentări de pe server`);
            continue;
          }
          const feat = pipelineStreetsRaw?.features.find(
            (f) => String((f.properties as { sid?: string })?.sid) === row.id
          );
          if (!feat?.geometry) {
            failed.push(`${row.id}: lipsește geometria străzii`);
            continue;
          }
          const oldPts = streetSplits[row.id] || [];
          const { inherit } = planSplitChange(row.id, feat.geometry, oldPts, row.splitPoints);
          const ifMatch = row.forceOverwrite ? "*" : splitsEditsUpdatedAt || undefined;
          await putSplits(row.id, row.splitPoints, inherit, ifMatch);
        } else if (row.kind === "streetFixes" && bundle.streetFixes) {
          if (!window.confirm("Corecțiile street-fixes rescriu CSV/OSM pentru întreaga hartă. Continui?")) continue;
          await putStreetFixes(bundle.streetFixes, row.forceOverwrite ? "*" : server.streetFixes?.updated_at);
        }
      } catch (e) {
        const locked = lockedHolder(e);
        if (e instanceof ApiError && (e.status === 423 || e.status === 409)) {
          failed.push(`${row.title}: ${locked || (e.status === 409 ? "conflict versiune" : "blocat")}`);
        } else {
          failed.push(`${row.title}: eșec`);
        }
      }
    }

    setFailures(failed);
    setApplying(false);
    await refreshLiveEdits();
    if (failed.length) {
      useApp.getState().showToast(`${failed.length} rânduri au eșuat — restul au fost aplicate`);
    } else {
      useApp.getState().showToast("Import aplicat");
      onDone();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="sheet-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={springExit({ opacity: 0 })}
          role="presentation"
          onClick={onClose}
        >
          <motion.div
            className="sheet edit-review-sheet"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={springExit({ y: 16, opacity: 0 })}
            transition={panelSpring}
            role="dialog"
            aria-labelledby="edit-review-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <h2 id="edit-review-title">Revizuire import editări</h2>
              <Tip text="Renunță">
                <button type="button" className="icon-x" onClick={onClose} aria-label="Renunță">
                  <X size={18} strokeWidth={2.25} />
                </button>
              </Tip>
            </div>
            <p className="sub">Nimic nu se scrie pe server până nu apeși „Aplică selectate”.</p>
            <ul className="edits-list edit-review-list">
              {rows.map((row) => (
                <li key={`${row.kind}:${row.id}`}>
                  <label className="edit-review-row">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={row.state === "same"}
                      onChange={(e) => toggleRow(row.id, row.kind, e.target.checked)}
                    />
                    <span>
                      <strong>{row.title}</strong>
                      {row.detail ? <span className="sub"> — {row.detail}</span> : null}
                      {row.state === "replace" ? (
                        <label className="sub force-row">
                          <input
                            type="checkbox"
                            checked={row.forceOverwrite}
                            onChange={(e) => toggleForce(row.id, row.kind, e.target.checked)}
                          />
                          Suprascrie (ignoră versiunea de pe server)
                        </label>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {failures.length ? (
              <ul className="sub">
                {failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
            <div className="edit-review-actions">
              <button type="button" className="btn" onClick={onClose} disabled={applying}>
                Renunță
              </button>
              <button type="button" className="btn primary" disabled={!selectedCount || applying} onClick={() => void apply()}>
                Aplică selectate
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
