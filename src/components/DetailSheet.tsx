import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Home, Building2, Building, Store, Scissors, Pencil, X, Ruler, Road, Car, Footprints, ParkingSquare, Bike, Trees, TriangleAlert, Trash2 } from "lucide-react";
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

function sameMetric(a: unknown, b: unknown) {
    const av = a ?? null;
    const bv = b ?? null;
    return typeof av === "number" && typeof bv === "number" && Number.isNaN(av) && Number.isNaN(bv) ? true : av === bv;
}

function measurementDraftDiffers(a: Measurement, b: Measurement) {
    if ((a.name || "") !== (b.name || "")) return true;
    if (Boolean(a.illgl_park) !== Boolean(b.illgl_park)) return true;
    return FORM_FIELDS.some((f) => !sameMetric(a[f.key], b[f.key]));
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
    const flushStreet = useRef<(() => void) | null>(null);
    const bindStreetFlush = useCallback((fn: (() => void) | null) => {
        flushStreet.current = fn;
    }, []);
    const requestClose = useCallback(() => {
        flushStreet.current?.();
        closeSheet();
    }, [closeSheet]);
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
                                    onSave={(data) => saveStreet(selected.id, data, { quiet: true })}
                                    onBindFlush={bindStreetFlush}
                                    onSplit={() => {
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
                                onClose={requestClose}
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

const STREET_SAVE_DELAY_MS = 400;

function useStreetAutosave(
    draft: Measurement,
    baseline: MutableRefObject<Measurement>,
    fallbackName: string,
    onSave: (data: Measurement) => Promise<boolean>,
) {
    const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const draftRef = useRef(draft);
    const nameRef = useRef(fallbackName);
    const onSaveRef = useRef(onSave);
    const kickRef = useRef<() => Promise<void>>(async () => {});
    const alive = useRef(true);
    const suppressed = useRef(false);
    const tail = useRef(Promise.resolve());
    const timer = useRef<number | null>(null);
    draftRef.current = draft;
    nameRef.current = fallbackName;
    onSaveRef.current = onSave;

    const clearTimer = useCallback(() => {
        if (timer.current != null) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
    }, []);

    const kick = useCallback(() => {
        const job = tail.current.then(async () => {
            if (suppressed.current) return;
            const current = draftRef.current;
            if (!measurementDraftDiffers(current, baseline.current)) return;
            const savedDraft = { ...current };
            const payload: Measurement = { ...savedDraft, name: savedDraft.name || nameRef.current, source: "local" };
            if (alive.current) setPhase("saving");
            let ok = false;
            try {
                ok = await onSaveRef.current(payload);
            } catch {
                ok = false;
            }
            if (suppressed.current) return;
            if (ok) baseline.current = { ...savedDraft, source: "local" };
            if (!alive.current) return;
            if (ok && measurementDraftDiffers(draftRef.current, baseline.current)) {
                queueMicrotask(() => {
                    void kickRef.current();
                });
                return;
            }
            setPhase(ok ? "saved" : "error");
        });
        tail.current = job.then(
            () => undefined,
            () => undefined,
        );
        return job;
    }, [baseline]);
    kickRef.current = kick;

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    useEffect(() => {
        return () => {
            clearTimer();
            void kick();
        };
    }, [clearTimer, kick]);

    useEffect(() => {
        if (suppressed.current || !measurementDraftDiffers(draft, baseline.current)) return;
        clearTimer();
        timer.current = window.setTimeout(() => {
            timer.current = null;
            void kick();
        }, STREET_SAVE_DELAY_MS);
        return () => clearTimer();
    }, [draft, baseline, clearTimer, kick]);

    const flushNow = useCallback(() => {
        if (suppressed.current) return;
        clearTimer();
        void kick();
    }, [clearTimer, kick]);

    const prepareDelete = useCallback(async () => {
        suppressed.current = true;
        clearTimer();
        await tail.current;
    }, [clearTimer]);

    const resume = useCallback(() => {
        suppressed.current = false;
        void kick();
    }, [kick]);

    return { phase, flushNow, prepareDelete, resume };
}

function StreetEditor({
    id,
    name,
    initial,
    hasLocalEdit,
    onSave,
    onBindFlush,
    onSplit,
    onClose,
}: {
    id: string;
    name: string;
    initial?: Measurement;
    hasLocalEdit: boolean;
    onSave: (d: Measurement) => Promise<boolean>;
    onBindFlush: (fn: (() => void) | null) => void;
    onSplit: () => void;
    onClose: () => void;
}) {
    const baseline = useRef<Measurement>({ name, ...initial, source: "local" });
    const [draft, setDraft] = useState<Measurement>(() => ({ ...baseline.current }));
    const { phase, flushNow, prepareDelete, resume } = useStreetAutosave(draft, baseline, name, onSave);

    useEffect(() => {
        onBindFlush(flushNow);
        return () => onBindFlush(null);
    }, [flushNow, onBindFlush]);

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        flushNow();
    };

    const fromSeed = (initial?.source === "seed" || initial?.source === "csv") && !hasLocalEdit;
    const saveLabel = phase === "saving" ? "Se salvează…" : phase === "error" ? "Nu s-a salvat" : phase === "saved" ? "Salvat" : "";

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
                    ? "Datele din tabel sunt pe toate segmentele cu acest nume. Ce schimbi aici se salvează doar pe acest segment."
                    : hasLocalEdit
                      ? "Modificările se salvează singure, doar pe acest segment."
                      : "Completează lățimile. Se salvează singur, doar pe acest segment, nu pe celelalte bucăți cu același nume."}
            </p>
            <SpaceBar m={draft} />
            <form
                className="form"
                onSubmit={onSubmit}
                onBlur={(e) => {
                    const next = e.relatedTarget;
                    if (next instanceof Node && e.currentTarget.contains(next)) return;
                    flushNow();
                }}
            >
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

                {saveLabel ? (
                    <p className={`editor-save${phase === "error" ? " is-error" : ""}`} aria-live="polite">
                        {saveLabel}
                    </p>
                ) : null}
                <button type="button" className="btn wide" onClick={() => {
                    flushNow();
                    onSplit();
                }}>
                    <Scissors size={15} strokeWidth={2.25} aria-hidden />
                    Segmentează strada în bucăți
                </button>
                {hasLocalEdit && (
                    <>
                        <button
                            type="button"
                            className="btn danger-ghost wide"
                            onClick={() => {
                                if (!window.confirm(`Ștergi măsurătorile salvate pentru „${name}”?`)) return;
                                void (async () => {
                                    await prepareDelete();
                                    await useApp.getState().deleteStreetEdit(id);
                                    const sel = useApp.getState().selected;
                                    if (useApp.getState().sheetOpen && sel?.kind === "street" && sel.id === id) resume();
                                })();
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
    onClose,
    editMode,
    lockHolder,
}: {
    id: string;
    type: string;
    onApply: (id: string, t: string) => Promise<boolean>;
    onClose: () => void;
    editMode: boolean;
    lockHolder?: string | null;
}) {
    const currentType = coerceBuildingType(type);
    const [saving, setSaving] = useState(false);
    const current = buildingTypeMeta(currentType);
    const CurrentIcon = BUILDING_ICONS[current.icon];

    const pick = async (next: string) => {
        if (saving || next === currentType) return;
        setSaving(true);
        try {
            const ok = await onApply(id, next);
            if (ok) onClose();
            else setSaving(false);
        } catch {
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
                                    className={currentType === t ? "on" : ""}
                                    aria-pressed={currentType === t}
                                    disabled={saving}
                                    onClick={() => void pick(t)}
                                >
                                    <span className="bgrid-ico" style={{ color: item.color, background: `color-mix(in srgb, ${item.color} 18%, transparent)` }}>
                                        <Icon size={18} strokeWidth={2.25} aria-hidden />
                                    </span>
                                    {item.label}
                                </button>
                            );
                        })}
                    </div>
                    {saving ? (
                        <p className="editor-save" aria-live="polite">
                            Se salvează…
                        </p>
                    ) : null}
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
