import { AnimatePresence, motion } from "framer-motion";
import { Pencil, Trash2, X } from "lucide-react";
import { useApp } from "../store";
import { panelSpring } from "../lib/uiMotion";
import { hasAnyEdit } from "../lib/space";

export function EditsPanel() {
  const open = useApp((s) => s.editsOpen);
  const streets = useApp((s) => s.streets);
  const measurements = useApp((s) => s.measurements);
  const closeEdits = useApp((s) => s.closeEdits);
  const openStreetEdit = useApp((s) => s.openStreetEdit);
  const deleteStreetEdit = useApp((s) => s.deleteStreetEdit);
  const purgeAllStreetEdits = useApp((s) => s.purgeAllStreetEdits);

  const editedEntries = Object.entries(measurements).filter(([, m]) => hasAnyEdit(m));

  const streetName = (id: string, m: (typeof measurements)[string]) => {
    const f = streets?.features.find((x) => String((x.properties as { sid?: string })?.sid) === id);
    const p = (f?.properties || {}) as { name?: string; cartier_name?: string; cartier?: string };
    return String(p.name || m.name || id);
  };

  const streetMeta = (id: string) => {
    const f = streets?.features.find((x) => String((x.properties as { sid?: string })?.sid) === id);
    const p = (f?.properties || {}) as { cartier_name?: string; cartier?: string };
    const cartier = String(p.cartier_name || p.cartier || "").trim();
    return cartier;
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="panel edits-panel"
          initial={{ x: 28, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 20, opacity: 0, pointerEvents: "none" }}
          transition={panelSpring}
        >
          <div className="panel-head">
            <h2>Editări locale</h2>
            <button type="button" className="icon-x" onClick={closeEdits} aria-label="Închide">
              <X size={18} strokeWidth={2.25} />
            </button>
          </div>

          {editedEntries.length === 0 ? (
            <p className="hint-text">Nu există editări pe segment.</p>
          ) : (
            <>
              <div className="edits-head">
                <span className="edits-count">{editedEntries.length} segmente</span>
                <button
                  type="button"
                  className="btn danger-ghost"
                  onClick={() => {
                    if (window.confirm(`Ștergi toate cele ${editedEntries.length} editări de pe server?`)) void purgeAllStreetEdits();
                  }}
                >
                  Șterge tot
                </button>
              </div>
              <ul className="edits-list">
                {editedEntries.map(([id, m]) => (
                  <li key={id}>
                    <span className="edits-name">
                      {streetName(id, m)}
                      {streetMeta(id) ? <span className="edits-sid">{streetMeta(id)}</span> : null}
                    </span>
                    <span className="edits-actions">
                      <button type="button" className="icon-mini" title="Editează" aria-label="Editează" onClick={() => openStreetEdit(id)}>
                        <Pencil size={15} strokeWidth={2.25} />
                      </button>
                      <button
                        type="button"
                        className="icon-mini danger"
                        title="Șterge"
                        aria-label="Șterge"
                        onClick={() => {
                          if (window.confirm(`Ștergi editarea pentru „${streetName(id, m)}”?`)) void deleteStreetEdit(id);
                        }}
                      >
                        <Trash2 size={15} strokeWidth={2.25} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
