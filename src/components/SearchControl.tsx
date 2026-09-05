import { AnimatePresence, motion } from "framer-motion";
import { GraduationCap, MapPin, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { isDesktopViewport } from "../lib/breakpoints";
import { panelSpring, popExit } from "../lib/uiMotion";
import { useApp } from "../store";
import {
  buildSearchIndex,
  filterSearchHits,
  groupSearchHits,
  SEARCH_KIND_LABEL,
  type SearchHit,
  type SearchKind,
} from "../lib/mapSearch";

function KindIcon({ kind }: { kind: SearchKind }) {
  if (kind === "school") return <GraduationCap size={15} strokeWidth={2.25} aria-hidden />;
  if (kind === "neighborhood") return <MapPin size={15} strokeWidth={2.25} aria-hidden />;
  return <Search size={15} strokeWidth={2.25} aria-hidden />;
}

export function SearchControl() {
  const open = useApp((s) => s.searchOpen);
  const ready = useApp((s) => s.ready);
  const streets = useApp((s) => s.streets);
  const neighborhoods = useApp((s) => s.neighborhoods);
  const schools = useApp((s) => s.schools);
  const neighborhoodList = useApp((s) => s.neighborhoodList);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const index = useMemo(
    () => (ready ? buildSearchIndex(streets, neighborhoods, schools, neighborhoodList) : []),
    [ready, streets, neighborhoods, schools, neighborhoodList]
  );

  const hits = useMemo(() => filterSearchHits(index, query), [index, query]);
  const groups = useMemo(() => groupSearchHits(hits), [hits]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      return;
    }
    if (isDesktopViewport()) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 40);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (e.key === "Escape" && useApp.getState().searchOpen) {
        e.preventDefault();
        useApp.getState().closeSearch();
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useApp.getState().toggleSearch();
        return;
      }
      if (!typing && e.key === "/" && !mod && !e.altKey) {
        e.preventDefault();
        if (!useApp.getState().searchOpen) useApp.getState().toggleSearch();
        else inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) useApp.getState().closeSearch();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-search-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, flat]);

  const selectHit = (hit: SearchHit) => {
    useApp.getState().focusSearchResult(hit);
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!flat.length) return;
      setActive((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      setActive((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[active] || flat[0];
      if (hit) selectHit(hit);
    } else if (e.key === "Escape") {
      e.preventDefault();
      useApp.getState().closeSearch();
    }
  };

  let running = 0;

  return (
    <div className="search-control" ref={rootRef}>
      <button
        type="button"
        className={`chip-btn search-btn ${open ? "on" : ""}`}
        onClick={() => useApp.getState().toggleSearch()}
        aria-expanded={open}
        aria-controls="map-search-popover"
        aria-haspopup="dialog"
        aria-pressed={open}
        aria-keyshortcuts="Control+K Meta+K"
        title="Caută (Ctrl+K)"
      >
        <Search size={16} strokeWidth={2.25} aria-hidden />
        <span>Caută</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id="map-search-popover"
            className="popover search-pop"
            role="dialog"
            aria-label="Caută stradă, cartier sau școală"
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={popExit()}
            transition={panelSpring}
          >
            <div className="search-field">
              <Search size={16} strokeWidth={2.25} aria-hidden />
              <input
                ref={inputRef}
                type="search"
                name="map-search"
                autoComplete="off"
                spellCheck={false}
                inputMode="search"
                enterKeyHint="search"
                placeholder="Stradă, cartier sau școală…"
                aria-label="Caută stradă, cartier sau școală"
                aria-autocomplete="list"
                aria-controls="map-search-results"
                aria-activedescendant={flat[active] ? `map-search-opt-${active}` : undefined}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
              />
              {query ? (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  aria-label="Șterge căutarea"
                >
                  <X size={14} strokeWidth={2.4} aria-hidden />
                </button>
              ) : null}
            </div>

            <div
              id="map-search-results"
              className="search-results"
              role="listbox"
              aria-label="Rezultate"
              ref={listRef}
            >
              {!query.trim() && (
                <p className="search-hint">Tastează un nume — străzi OSM, cartiere sau școli din Sibiu.</p>
              )}
              {query.trim() && !flat.length && (
                <p className="search-empty" role="status">
                  Niciun rezultat pentru „{query.trim()}”.
                </p>
              )}
              {groups.map((g) => (
                <div key={g.kind} className="search-group" role="group" aria-label={SEARCH_KIND_LABEL[g.kind]}>
                  <div className="search-group-label">{SEARCH_KIND_LABEL[g.kind]}</div>
                  {g.items.map((hit) => {
                    const idx = running++;
                    const isActive = idx === active;
                    return (
                      <button
                        key={hit.id}
                        type="button"
                        id={`map-search-opt-${idx}`}
                        data-search-idx={idx}
                        role="option"
                        aria-selected={isActive}
                        className={`search-hit kind-${hit.kind} ${isActive ? "on" : ""}`}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => selectHit(hit)}
                      >
                        <span className="search-hit-ico">
                          <KindIcon kind={hit.kind} />
                        </span>
                        <span className="search-hit-copy">
                          <span className="search-hit-label">{hit.label}</span>
                          {hit.hint ? <span className="search-hit-hint">{hit.hint}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="search-kbd" aria-hidden>
              ↑↓ alege · Enter deschide · Esc închide
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
