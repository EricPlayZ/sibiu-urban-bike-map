import { FormEvent, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Home, Building2, Package, HelpCircle, Pencil, X, Ruler, Road, Car, Footprints, ParkingSquare, Bike, Trees, TriangleAlert, Save, Trash2 } from "lucide-react";
import { useApp } from "../store";
import { isDesktopViewport } from "../lib/breakpoints";
import { FORM_FIELDS, pct, spaceShares, featureHasIllegalParking, featureHasReservedParking, resolveStreetMeasurement, streetBikeLaneStatus, streetHasBikeLane, type Measurement } from "../lib/space";

const FIELD_ICONS: Partial<Record<keyof Measurement, typeof Ruler>> = {
    length_m: Ruler,
    row_width_m: Road,
    carriageway_m: Car,
    sidewalk1_m: Footprints,
    sidewalk2_m: Footprints,
    parking1_m: ParkingSquare,
    parking2_m: ParkingSquare,
    bike1_m: Bike,
    bike2_m: Bike,
    green1_m: Trees,
    green2_m: Trees,
    free_sidewalk1_m: Footprints,
    free_sidewalk2_m: Footprints,
};

function schoolName(slug: string, schools: GeoJSON.FeatureCollection | null) {
    if (!schools || !slug) return slug;
    const hit = schools.features.find((f) => (f.properties as { slug?: string })?.slug === slug);
    return String((hit?.properties as { denumire?: string })?.denumire || slug);
}

export function DetailSheet() {
    const open = useApp((s) => s.sheetOpen);
    const selected = useApp((s) => s.selected);
    const editMode = useApp((s) => s.editMode);
    const teamAuthed = useApp((s) => s.teamAuthed);
    const entityLock = useApp((s) => s.entityLock);
    const refreshEntityLock = useApp((s) => s.refreshEntityLock);
    const dropEntityLock = useApp((s) => s.dropEntityLock);
    const measurements = useApp((s) => s.measurements);
    const seedMeasurements = useApp((s) => s.seedMeasurements);
    const closeSheet = useApp((s) => s.closeSheet);
    const saveStreet = useApp((s) => s.saveStreet);
    const setBuildingType = useApp((s) => s.setBuildingType);

    const existing = useMemo(() => {
        if (selected?.kind !== "street") return undefined;
        return resolveStreetMeasurement(selected.id, selected.props, measurements, seedMeasurements);
    }, [selected, measurements, seedMeasurements]);
    const hasLocalEdit = selected?.kind === "street" ? Boolean(measurements[selected.id]) : false;
    const desktop = isDesktopViewport();
    const canEdit = Boolean(editMode && teamAuthed && entityLock.held);
    useEffect(() => {
        if (!open || !selected || !editMode || !teamAuthed) return;
        const kind = selected.kind;
        const id = selected.id;
        void refreshEntityLock(kind, id);
        const t = window.setInterval(() => void refreshEntityLock(kind, id), 20_000);
        return () => {
            window.clearInterval(t);
            void dropEntityLock(kind, id);
        };
    }, [open, selected, editMode, teamAuthed, refreshEntityLock, dropEntityLock]);

    // Scrimul se demontează imediat; panoul rămâne pe exit — fără hit-testing în timpul animației.
    useLayoutEffect(() => {
        if (open) return;
        document.querySelectorAll<HTMLElement>(".sheet").forEach((el) => {
            el.style.pointerEvents = "none";
            el.setAttribute("aria-hidden", "true");
        });
    }, [open]);

    return (
        <>
            {open && selected && <button type="button" className="sheet-scrim" onClick={closeSheet} aria-label="Închide panoul" />}
            <AnimatePresence>
                {open && selected && (
                    <motion.div
                        className="sheet"
                        initial={desktop ? { opacity: 0, y: 16 } : { y: "110%" }}
                        animate={desktop ? { opacity: 1, y: 0 } : { y: 0 }}
                        exit={{
                            ...(desktop ? { opacity: 0, y: 12 } : { y: "110%" }),
                            pointerEvents: "none",
                            transition: {
                                type: "spring",
                                stiffness: 380,
                                damping: 36,
                                pointerEvents: { duration: 0 },
                            },
                        }}
                        transition={{ type: "spring", stiffness: 380, damping: 36 }}
                        role="dialog"
                        aria-modal="true"
                    >
                        <div className="sheet-handle" />
                        {selected.kind === "street" ? (
                            canEdit ? (
                                <StreetEditor
                                    key={selected.id}
                                    id={selected.id}
                                    name={selected.name}
                                    initial={existing}
                                    hasLocalEdit={hasLocalEdit}
                                    onSave={(data) => void saveStreet(selected.id, data)}
                                    onClose={closeSheet}
                                />
                            ) : (
                                <StreetPublic
                                    name={selected.name}
                                    m={existing}
                                    props={selected.props}
                                    onClose={closeSheet}
                                    lockHolder={!entityLock.held ? entityLock.holder : null}
                                    onEditHint={teamAuthed ? () => useApp.getState().setEditMode(true) : undefined}
                                />
                            )
                        ) : (
                            <BuildingEditor id={selected.id} type={selected.type} onPick={(id, t) => void setBuildingType(id, t)} onClose={closeSheet} editMode={canEdit} lockHolder={!entityLock.held ? entityLock.holder : null} />
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}

function StreetPublic({ name, m, props, onClose, onEditHint, lockHolder }: { name: string; m?: Measurement; props: Record<string, unknown>; onClose: () => void; onEditHint?: () => void; lockHolder?: string | null }) {
    const schools = useApp((s) => s.schools);
    const shares = spaceShares(m);
    const bikeStatus = streetBikeLaneStatus(props, m);
    const bike = streetHasBikeLane(props, m);
    const illegal = featureHasIllegalParking(props);
    const reserved = featureHasReservedParking(props);
    const arondat = String(props.arondat || "").trim();

    return (
        <div className="sheet-body">
            <div className="sheet-head">
                <h3>{name}</h3>
                <button type="button" className="icon-x" onClick={onClose} aria-label="Închide">
                    <X size={18} strokeWidth={2.25} />
                </button>
            </div>

            <ul className="flag-list">
                {bikeStatus === "door" && (
                    <li className="yes">✔ Pistă pe carosabil: între carosabil și mașinile parcate</li>
                )}
                {bikeStatus === "safe" && <li className="yes">✔ Pistă de biciclete: Da</li>}
                {bikeStatus === "none" && <li className="no">✖ Pistă de biciclete: Nu</li>}
                {illegal && <li className="warn">⚠ Parcare ilegală pe trotuar: Da</li>}
                {reserved && <li className="info">🅿️ Parcare amenajată pe trotuar: Da</li>}
                {arondat && <li className="info">🏫 Arondată la: {schoolName(arondat, schools)}</li>}
                {!bike && !illegal && !reserved && !arondat && bikeStatus === "unknown" && !shares && (
                    <li className="muted">Nu există date specifice pentru această stradă.</li>
                )}
            </ul>

            {shares && (
                <>
                    <SpaceBar m={m} />
                    <p className="sub">
                        Spațiu pietoni + biciclete + verde: <b>{pct(shares.equity)}</b>
                    </p>
                </>
            )}
            {!shares && m && <p className="sub">Există date parțiale, dar fără lățimi complete pentru bara de spațiu.</p>}
            {lockHolder ? <p className="sub">{lockHolder} editează acest segment.</p> : null}
            {onEditHint ? (
                <button type="button" className="btn primary wide" onClick={onEditHint}>
                    {shares || bike || illegal || reserved || arondat ? "Editează măsurătorile" : "Pornește editarea"}
                </button>
            ) : null}
        </div>
    );
}

function StreetEditor({
    id,
    name,
    initial,
    hasLocalEdit,
    onSave,
    onClose,
}: {
    id: string;
    name: string;
    initial?: Measurement;
    hasLocalEdit: boolean;
    onSave: (d: Measurement) => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState<Measurement>(() => ({ name, ...initial, source: "local" }));

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        onSave({ ...draft, name: draft.name || name, source: "local" });
    };

    const fromSeed = (initial?.source === "seed" || initial?.source === "csv") && !hasLocalEdit;

    return (
        <div className="sheet-body editor-sheet">
            <div className="sheet-head">
                <h3>
                    <span className="editor-title-ico" aria-hidden>
                        <Pencil size={16} strokeWidth={2.25} />
                    </span>
                    {name}
                </h3>
                <button type="button" className="icon-x" onClick={onClose} aria-label="Închide">
                    <X size={18} strokeWidth={2.25} />
                </button>
            </div>
            <p className="sub">
                {fromSeed
                    ? "Datele s-au aplicat pe toate segmentele cu acest nume. Salvarea rămâne doar pe acest segment."
                    : hasLocalEdit
                      ? "Editare pe acest segment, nu pe toată strada."
                      : "Completează lățimile — salvarea e doar pe acest segment, nu pe celelalte bucăți cu același nume."}
            </p>
            <SpaceBar m={draft} />
            <form className="form" onSubmit={onSubmit}>
                <label className="field field-named">
                    <span className="field-cap">
                        <Road size={14} strokeWidth={2.25} aria-hidden />
                        Nume stradă
                    </span>
                    <input value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>

                <div className="field-label">Dimensiuni (m)</div>
                <div className="form-grid">
                    {FORM_FIELDS.map((f) => {
                        const Icon = FIELD_ICONS[f.key] || Ruler;
                        return (
                            <label key={f.key} className="field">
                                <span className="field-cap">
                                    <Icon size={14} strokeWidth={2.25} aria-hidden />
                                    {f.label}
                                </span>
                                <input
                                    type="number"
                                    step="0.1"
                                    inputMode="decimal"
                                    value={draft[f.key] == null ? "" : String(draft[f.key])}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setDraft({ ...draft, [f.key]: v === "" ? undefined : Number(v) });
                                    }}
                                />
                            </label>
                        );
                    })}
                </div>

                <label className={`editor-flag ${draft.illgl_park ? "on" : ""}`}>
                    <span className="editor-flag-ico" aria-hidden>
                        <TriangleAlert size={18} strokeWidth={2.25} />
                    </span>
                    <span className="editor-flag-copy">
                        <strong>Parcare ilegală pe trotuar</strong>
                        <small>Marchează dacă există ocupare ilegală</small>
                    </span>
                    <input type="checkbox" checked={!!draft.illgl_park} onChange={(e) => setDraft({ ...draft, illgl_park: e.target.checked })} />
                </label>

                <div className="actions">
                    <button type="submit" className="btn primary">
                        <Save size={16} strokeWidth={2.25} aria-hidden />
                        Salvează
                    </button>
                    <button type="button" className="btn" onClick={onClose}>
                        Închide
                    </button>
                </div>
                {hasLocalEdit && (
                    <button
                        type="button"
                        className="btn danger-ghost wide"
                        onClick={() => {
                            if (window.confirm(`Ștergi editarea locală pentru „${name}”?`)) {
                                useApp.getState().deleteStreetEdit(id);
                            }
                        }}
                    >
                        <Trash2 size={15} strokeWidth={2.25} aria-hidden />
                        Șterge editarea locală
                    </button>
                )}
            </form>
        </div>
    );
}

function BuildingEditor({ id, type, onPick, onClose, editMode, lockHolder }: { id: string; type: string; onPick: (id: string, t: string) => void; onClose: () => void; editMode: boolean; lockHolder?: string | null }) {
    const meta: Record<string, { label: string; color: string; blurb: string; Icon: typeof Home }> = {
        casa: { label: "Casă", color: "#2f9e44", blurb: "Categorie: casă", Icon: Home },
        bloc: { label: "Bloc", color: "#e03131", blurb: "Categorie: bloc", Icon: Building2 },
        altceva: { label: "Altceva", color: "#868e96", blurb: "Altă categorie decât casă / bloc", Icon: Package },
        necunoscut: { label: "Necunoscut", color: "#ced4da", blurb: "Neclasificat încă — alege tipul dacă știi", Icon: HelpCircle },
    };
    const current = meta[type] || meta.necunoscut;
    const CurrentIcon = current.Icon;

    return (
        <div className="sheet-body bldg-sheet">
            <div className="sheet-head">
                <h3>Clădire</h3>
                <button type="button" className="icon-x" onClick={onClose} aria-label="Închide">
                    <X size={18} strokeWidth={2.25} />
                </button>
            </div>

            <div className="bldg-summary">
                <span className="bldg-chip" style={{ "--c": current.color } as CSSProperties}>
                    <CurrentIcon size={14} strokeWidth={2.25} />
                    {current.label}
                </span>
                <p className="bldg-blurb">{current.blurb}</p>
            </div>

            {editMode ? (
                <>
                    <div className="field-label">Alege tipul</div>
                    <div className="bgrid">
                        {(Object.keys(meta) as (keyof typeof meta)[]).map((t) => {
                            const item = meta[t];
                            const Icon = item.Icon;
                            return (
                                <button
                                    key={t}
                                    type="button"
                                    className={type === t ? "on" : ""}
                                    onClick={() => {
                                        onPick(id, t);
                                        onClose();
                                    }}
                                >
                                    <span className="bgrid-ico" style={{ color: item.color, background: `color-mix(in srgb, ${item.color} 18%, transparent)` }}>
                                        <Icon size={18} strokeWidth={2.25} aria-hidden />
                                    </span>
                                    {item.label}
                                </button>
                            );
                        })}
                    </div>
                </>
            ) : (
                <p className="sub">
                    {lockHolder ? `${lockHolder} editează această clădire.` : "Tipul se schimbă doar din modul de editare al echipei."}
                </p>
            )}
        </div>
    );
}

function SpaceBar({ m }: { m?: Measurement }) {
    const shares = useMemo(() => spaceShares(m), [m]);
    if (!shares) return <div className="space-bar empty">Completează lățimile pentru bara de spațiu</div>;
    const parts = [
        { label: "Mașini", color: "#5c6670", v: shares.carriageway },
        { label: "Parcare", color: "#e6a700", v: shares.parking },
        { label: "Pietoni", color: "#1b9a8a", v: shares.sidewalk },
        { label: "Biciclete", color: "#2f9e44", v: shares.bike },
        { label: "Verde", color: "#1b5e20", v: shares.green },
    ].filter((p) => p.v > 0.005);
    return (
        <>
            <div className="space-bar">
                {parts.map((p) => (
                    <motion.span key={p.label} className="seg" style={{ background: p.color }} initial={{ width: 0 }} animate={{ width: `${p.v * 100}%` }} transition={{ type: "spring", stiffness: 160, damping: 22 }} />
                ))}
            </div>
            <div className="space-legs">
                {parts.map((p) => (
                    <span key={p.label}>
                        <i style={{ background: p.color }} />
                        {p.label} {pct(p.v)}
                    </span>
                ))}
            </div>
        </>
    );
}
