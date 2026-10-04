import { AnimatePresence, motion } from "framer-motion";
import { Check, Eraser, Scissors, Undo2, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { computePieces } from "../lib/streetSplits";
import { popSpring, springExit } from "../lib/uiMotion";
import { useApp, type SplitTool } from "../store";

function pointsChanged(tool: SplitTool) {
  return (
    tool.points.length !== tool.before.length ||
    tool.points.some((p, i) => p[0] !== tool.before[i]?.[0] || p[1] !== tool.before[i]?.[1])
  );
}

/** Bara de jos cât timp se segmentează o stradă: click pe hartă = punct nou, click pe un punct = îl scoate. */
export function SplitToolbar() {
  const tool = useApp((s) => s.splitTool);
  const cancel = useApp((s) => s.cancelSplitTool);
  const apply = useApp((s) => s.applySplitTool);
  const revert = useApp((s) => s.revertSplitPoints);
  const removeLast = useApp((s) => s.removeSplitPoint);

  const refreshLock = useApp((s) => s.refreshEntityLock);
  const root = tool?.root ?? null;

  // Lock-ul expiră în ~45 s: cât timp unealta e deschisă, îl reînnoim.
  useEffect(() => {
    if (!root) return;
    const t = window.setInterval(() => void refreshLock("street", root), 20_000);
    return () => window.clearInterval(t);
  }, [root, refreshLock]);

  const pieces = useMemo(
    () => (tool ? computePieces(tool.root, tool.geometry, tool.points).length : 0),
    [tool?.root, tool?.geometry, tool?.points]
  );
  const changed = tool ? pointsChanged(tool) : false;

  const closeTool = () => {
    if (!tool) return;
    if (changed && !window.confirm("Ai modificări nesalvate la punctele de tăiere. Închizi fără să salvezi?")) return;
    cancel();
  };

  return (
    <AnimatePresence>
      {tool && (
        <motion.div
          key="split-toolbar"
          className="split-toolbar"
          role="region"
          aria-label="Segmentare stradă"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={springExit({ opacity: 0, y: 12 })}
          transition={popSpring}
        >
          <div className="split-toolbar-copy">
            <strong>
              <Scissors size={15} strokeWidth={2.25} aria-hidden /> {tool.name}
            </strong>
            <span>
              {pieces > 1 ? `${pieces} bucăți` : "Nesegmentată"} · atinge strada ca să adaugi un punct de tăiere, atinge un punct ca să-l scoți
            </span>
          </div>
          <div className="split-toolbar-actions">
            <button
              type="button"
              className="btn"
              onClick={() => removeLast(tool.points.length - 1)}
              disabled={tool.saving || tool.points.length === 0}
              aria-label="Undo: anulează ultimul punct"
            >
              <Undo2 size={15} strokeWidth={2.25} aria-hidden />
              Undo
            </button>
            <button
              type="button"
              className="btn"
              onClick={revert}
              disabled={tool.saving || !changed}
              aria-label="Clear: șterge modificările nesalvate"
            >
              <Eraser size={15} strokeWidth={2.25} aria-hidden />
              Clear
            </button>
            <button type="button" className="btn" onClick={closeTool} disabled={tool.saving} aria-label="Închide segmentarea">
              <X size={15} strokeWidth={2.25} aria-hidden />
              Închide
            </button>
            <button type="button" className="btn primary" onClick={() => void apply()} disabled={tool.saving || !changed}>
              <Check size={15} strokeWidth={2.25} aria-hidden />
              {tool.saving ? "Se salvează…" : "Aplică"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
