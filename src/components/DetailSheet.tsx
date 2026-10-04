import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Home, Building2, Building, Store, Scissors, Undo2, Check, Pencil, X, Ruler, Road, Car, Footprints, ParkingSquare, Bike, Trees, TriangleAlert, Save, Trash2 } from "lucide-react";
import { useApp } from "../store";
import { isDesktopViewport } from "../lib/breakpoints";
import { panelSpring, springExit } from "../lib/uiMotion";
import { streetSchoolSlugs } from "../lib/schoolCatchment";
import { BIKE_DOOR_LABEL, BIKE_SAFE_LABEL } from "../lib/layers";
import { FORM_FIELDS, pct, spaceShares, featureHasIllegalParking, featureHasReservedParking, resolveStreetMeasurement, streetBikeLaneStatus, streetHasBikeLane, type Measurement } from "../lib/space";
import { BUILDING_CLASSIFIED_TYPES, buildingTypeMeta, coerceBuildingType, type BuildingTypeMeta } from "../lib/buildingTypes";
import { FadeScrim } from "./FadeScrim";
import { Tip } from "./Tip";

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

function measurementDraftDiffers(a: Measurement, b: Measurement) {
    if ((a.name || "") !== (b.name || "")) return true;
    if (Boolean(a.illgl_park) !== Boolean(b.illgl_park)) return true;
    return FORM_FIELDS.some((f) => (a[f.key] ?? null) !== (b[f.key] ?? null));
}

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
    const startSplitTool = useApp((s) => s.startSplitTool);
    const [dirty, setDirty] = useState(false);
    const dirtyRef = useRef(false);
    dirtyRef.current = dirty;
    const selKind = selected?.kind ?? null;
    const selId = selected?.id ?? null;

    const existing = useMemo(() => {
        if (selected?.kind !== "street") return undefined;
        return resolveStreetMeasurement(selected.id, selected.props, measurements, seedMeasurements);
    }, [selected, measurements, seedMeasurements]);
    const hasLocalEdit = selected?.kind === "street" ? Boolean(measurements[selected.id]) : false;
    const desktop = isDesktopViewport();
    const canEdit = Boolean(editMode && teamAuthed && entityLock.held);
    // Lock-ul depinde DOAR de (tip, id). Înainte depindea de obiectul `selected`, care se recreează la
    // fiecare eveniment live (altcineva salvează) → lock eliberat și re-cerut în buclă, cu curse între ele.
    useEffect(() => {
        if (!open || !selKind || !selId || !editMode || !teamAuthed) return;
        void refreshEntityLock(selKind, selId);
        const t = window.setInterval(() => void refreshEntityLock(selKind, selId), 20_000);
        return () => {
            window.clearInterval(t);
            void dropEntityLock(selKind, selId);
        };
    }, [open, selKind, selId, editMode, teamAuthed, refreshEntityLock, dropEntityLock]);

    // Modificările nesalvate aparțin unei singure entități.
    useEffect(() => {
        setDirty(false);
    }, [selKind, selId, open]);

    const requestClose = useCallback(() => {
        if (dirtyRef.current && !window.confirm("Ai modificări nesalvate. Renunți la ele?")) return;
        closeSheet();
    }, [closeSheet]);

    return (
        <AnimatePresence>
            {open && selected && (
                <FadeScrim key="sheet-scrim" className="sheet-scrim" onClick={requestClose} label="Închide panoul" />
            )}
            {open && selected && (
                    <motion.div
                        key="sheet"
                        className="sheet"
                        initial={desktop ? { opacity: 0, y: 16, pointerEvents: "auto" } : { y: "110%", pointerEvents: "auto" }}
                        animate={desktop ? { opacity: 1, y: 0, pointerEvents: "auto" } : { y: 0, pointerEvents: "auto" }}
                        exit={springExit(desktop ? { opacity: 0, y: 12 } : { y: "110%" })}
                        transition={{ ...panelSpring, pointerEvents: { duration: 0 } }}
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
                                    onSave={(data) => saveStreet(selected.id, data)}
                                    onDirtyChange={setDirty}
                                    onSplit={() => {
                                        if (dirtyRef.current && !window.confirm("Ai modificări nesalvate. Renunți la ele și segmentezi?")) return;
                                        setDirty(false);
                                        void startSplitTool(selected.id);
                                    }}
                                    onClose={requestClose}
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
                            <BuildingEditor
                                key={selected.id}
                                id={selected.id}
                                type={selected.type}
                                onApply={(id, t) => setBuildingType(id, t)}
                                onDirtyChange={setDirty}
                                onClose={requestClose}
                                onCloseNow={closeSheet}
                                editMode={canEdit}
                                lockHolder={!entityLock.held ? entityLock.holder : null}
                            />
                        )}
                    </motion.div>
            )}
        </AnimatePresence>
    );
}

function StreetPublic({ name, m, props, onClose, onEditHint, lockHolder }: { name: string; m?: Measurement; props: Record<string, unknown>; onClose: () => void; onEditHint?: () => void; lockHolder?: string | null }) {
    const schools = useApp((s) => s.schools);
    const shares = spaceShares(m);
    const bikeStatus = streetBikeLaneStatus(props, m);
    const bike = streetHasBikeLane(props, m);
    const illegal = featureHasIllegalParking(props);
    const reserved = featureHasReservedParking(props);
    const arondari = streetSchoolSlugs(props);

    return (
        <div className="sheet-body">
            <div className="sheet-head">
                <h3>{name}</h3>
                <Tip text="Închide">
                    <button type="button" className="icon-x" onClick={onClose} aria-label="Închide">
                        <X size={18} strokeWidth={2.25} />
                    </button>
                </Tip>
            </div>

            <ul className="flag-list">
                {bikeStatus === "door" && <li className="yes">✔ {BIKE_DOOR_LABEL}</li>}
                {bikeStatus === "safe" && <li className="yes">✔ {BIKE_SAFE_LABEL}</li>}
                {bikeStatus === "none" && <li className="no">✖ Pistă biciclete: Nu</li>}
                {illegal && <li className="warn">⚠ Parcare ilegală pe trotuar: Da</li>}
                {reserved && <li className="info">🅿️ Parcare amenajată pe trotuar: Da</li>}
                {arondari.length > 0 && (
                    <li className="info">🏫 Arondată la: {arondari.map((slug) => schoolName(slug, schools)).join(", ")}</li>
                )}
                {!bike && !illegal && !reserved && arondari.length === 0 && bikeStatus === "unknown" && !shares && (
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
                    {shares || bike || illegal || reserved || arondari.length ? "Editează măsurătorile" : "Pornește editarea"}
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
    onDirtyChange,
    onSplit,
    onClose,
}: {
    id: string;
    name: string;
    initial?: Measurement;
    hasLocalEdit: boolean;
    onSave: (d: Measurement) => Promise<boolean>;
    onDirtyChange: (dirty: boolean) => void;
    onSplit: () => void;
    onClose: () => void;
}) {
    const baseline = useRef<Measurement>({ name, ...initial, source: "local" });
    const [draft, setDraft] = useState<Measurement>(() => ({ ...baseline.current }));
    const [saving, setSaving] = useState(false);
    const dirty = useMemo(() => measurementDraftDiffers(draft, baseline.current), [draft]);

    useEffect(() => {
        onDirtyChange(dirty);
        return () => onDirtyChange(false);
    }, [dirty, onDirtyChange]);

    const apply = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const ok = await onSave({ ...draft, name: draft.name || name, source: "local" });
            // Salvat → panoul se închide; eșec (lock/conflict/rețea) → rămâi în editor cu modificările tale.
            if (ok) {
                onDirtyChange(false);
                useApp.getState().closeSheet();
            }
        } finally {
            setSaving(false);
        }
    };

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        void apply();
    };

    const discard = () => {
        if (dirty) {
            // „Renunță” = aruncă modificările și rămâi în panou, cu valorile de la deschidere.
            setDraft({ ...baseline.current });
            return;
        }
        onClose();
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
                <Tip text="Închide">
                    <button type="button" className="icon-x" onClick={onClose} aria-label="Închide">
                        <X size={18} strokeWidth={2.25} />
                    </button>
                </Tip>
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

                <div className="actions sheet-actions">
                    <button type="submit" className="btn primary" disabled={saving || !dirty}>
                        <Check size={16} strokeWidth={2.25} aria-hidden />
                        {saving ? "Se salvează…" : "Aplică"}
                    </button>
                    <button type="button" className="btn" onClick={discard} disabled={saving}>
                        <Undo2 size={16} strokeWidth={2.25} aria-hidden />
                        {dirty ? "Renunță" : "Închide"}
                    </button>
                </div>
                <button type="button" className="btn wide" onClick={onSplit} disabled={saving}>
                    <Scissors size={15} strokeWidth={2.25} aria-hidden />
                    Segmentează strada în bucăți
                </button>
                {hasLocalEdit && (
                    <>
                        <button
                            type="button"
                            className="btn danger-ghost wide"
                            onClick={() => {
                                if (window.confirm(`Ștergi măsurătorile salvate pentru „${name}”?`)) {
                                    useApp.getState().deleteStreetEdit(id);
                                }
                            }}
                        >
                            <Trash2 size={15} strokeWidth={2.25} aria-hidden />
                            Șterge măsurătorile salvate
                        </button>
                        <p className="sub street-delete-note">Nu scoate segmentarea străzii. Segmentarea se șterge din lista de editări.</p>
                    </>
                )}
            </form>
        </div>
    );
}

const BUILDING_ICONS: Record<BuildingTypeMeta["icon"], typeof Home> = {
    home: Home,
    homes: Building2,
    building: Building2,
    tower: Building,
    store: Store,
};

function BuildingEditor({
    id,
    type,
    onApply,
    onDirtyChange,
    onClose,
    onCloseNow,
    editMode,
    lockHolder,
}: {
    id: string;
    type: string;
    onApply: (id: string, t: string) => Promise<boolean>;
    onDirtyChange: (dirty: boolean) => void;
    onClose: () => void;
    onCloseNow: () => void;
    editMode: boolean;
    lockHolder?: string | null;
}) {
    const currentType = coerceBuildingType(type);
    // Alegerea e doar „propusă” până apeși Aplică; Renunță o aruncă.
    const [pending, setPending] = useState<ReturnType<typeof coerceBuildingType> | null>(null);
    const [saving, setSaving] = useState(false);
    const dirty = editMode && pending != null && pending !== currentType;
    const shown = dirty && pending ? pending : currentType;
    const current = buildingTypeMeta(shown);
    const CurrentIcon = BUILDING_ICONS[current.icon];

    useEffect(() => {
        onDirtyChange(dirty);
        return () => onDirtyChange(false);
    }, [dirty, onDirtyChange]);

    const apply = async () => {
        if (saving || !dirty || !pending) return;
        setSaving(true);
        try {
            const ok = await onApply(id, pending);
            if (ok) {
                onDirtyChange(false);
                onCloseNow();
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="sheet-body bldg-sheet">
            <div className="sheet-head">
                <h3>Clădire</h3>
                <Tip text="Închide">
                    <button type="button" className="icon-x" onClick={onClose} aria-label="Închide">
                        <X size={18} strokeWidth={2.25} />
                    </button>
                </Tip>
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
                        {BUILDING_CLASSIFIED_TYPES.map((t) => {
                            const item = buildingTypeMeta(t);
                            const Icon = BUILDING_ICONS[item.icon];
                            return (
                                <button
                                    key={t}
                                    type="button"
                                    className={shown === t ? "on" : ""}
                                    disabled={saving}
                                    onClick={() => setPending(t)}
                                >
                                    <span className="bgrid-ico" style={{ color: item.color, background: `color-mix(in srgb, ${item.color} 18%, transparent)` }}>
                                        <Icon size={18} strokeWidth={2.25} aria-hidden />
                                    </span>
                                    {item.label}
                                </button>
                            );
                        })}
                    </div>
                    <div className="actions sheet-actions">
                        <button type="button" className="btn primary" onClick={() => void apply()} disabled={!dirty || saving}>
                            <Check size={16} strokeWidth={2.25} aria-hidden />
                            {saving ? "Se salvează…" : "Aplică"}
                        </button>
                        <button type="button" className="btn" onClick={() => (dirty ? setPending(null) : onClose())} disabled={saving}>
                            <Undo2 size={16} strokeWidth={2.25} aria-hidden />
                            {dirty ? "Renunță" : "Închide"}
                        </button>
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
