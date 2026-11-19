import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../design-system/Icon";
import { AppCell } from "./AppCell";
import { actions } from "./bridge";
import { DockIcon } from "./DockIcons";
import { EmptyGlyph } from "./EmptyGlyph";
import { anchorPoint, LIBRARY, libraryColumns } from "./geometry";
import { librarySections } from "./librarySections";
import { freshAppIds } from "./model";
import { isNavKey, moveAcrossSections, nextQuery, type GridPosition } from "./nav";
import type { DockApp } from "./protocol";
import { useDockStore } from "./store";
import { plural, t } from "./strings";
import { toneVar } from "./tones";
import "./library.css";


const START: GridPosition = { section: 0, index: 0 };

/**
 * The App Library: every app in its category, with a search field that filters as you type. Arrow keys move
 * through the grid across sections, Enter opens, Esc clears the search and then closes. Mounted only while open.
 */
export function Library() {
  const categories = useDockStore((s) => s.categories);
  const apps = useDockStore((s) => s.apps);
  const windows = useDockStore((s) => s.windows);
  const edge = useDockStore((s) => s.settings.edge);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<GridPosition>(START);
  const [cols, setCols] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const seenAtOpen = useRef(useDockStore.getState().seen);

  const sections = useMemo(() => librarySections(categories, apps, query), [categories, apps, query]);
  const counts = useMemo(() => sections.map((s) => s.apps.length), [sections]);
  const fresh = useMemo(() => freshAppIds(apps, seenAtOpen.current, Date.now()), [apps]);
  const running = useMemo(() => new Set(windows.flatMap((w) => (w.appId === null ? [] : [w.appId]))), [windows]);
  const total = counts.reduce((sum, n) => sum + n, 0);
  const selected = sections[pos.section]?.apps[pos.index] ?? null;

  useEffect(() => inputRef.current?.focus(), []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = (): void => {
      const style = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setCols(libraryColumns(Math.min(inner, LIBRARY.maxWidth)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (selected) cellRefs.current.get(selected.id)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const close = (): void => useDockStore.getState().setLibrary(false);
  const open = (app: DockApp): void => {
    close();
    void actions.open(app);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useDockStore.getState().menu !== null) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (query !== "") {
          setQuery("");
          setPos(START);
        } else close();
        return;
      }
      const arrowSideways = e.key === "ArrowLeft" || e.key === "ArrowRight";
      if (isNavKey(e.key) && !(arrowSideways && query !== "") && !((e.key === "Home" || e.key === "End") && query !== "")) {
        e.preventDefault();
        setPos((p) => moveAcrossSections(counts, p, e.key as Parameters<typeof moveAcrossSections>[2], cols));
        return;
      }
      if (e.key === "Enter" && selected) {
        e.preventDefault();
        open(selected);
        return;
      }
      if (document.activeElement !== inputRef.current && nextQuery(query, e) !== null) inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const gridStyle = { gridTemplateColumns: `repeat(${cols}, ${LIBRARY.cellW}px)` } as CSSProperties;
  const shell = {
    "--lib-cell-w": `${LIBRARY.cellW}px`,
    "--lib-cell-h": `${LIBRARY.cellH}px`,
    "--lib-face": `${LIBRARY.face}px`,
    "--lib-max": `${LIBRARY.maxWidth}px`,
    "--lib-pad": `${LIBRARY.pad}px`,
    "--lib-gap": `${LIBRARY.gap}px`,
    "--lib-section-hint": `${LIBRARY.cellH * 2}px`,
  } as CSSProperties;

  return (
    <div
      className="library"
      role="dialog"
      aria-modal="true"
      aria-label={t("library.title")}
      data-edge={edge}
      style={shell}
    >
      <header className="library__top">
        <h1 className="library__title caps">{t("library.title")}</h1>
        <label className="library__search">
          <DockIcon name="search" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={t("library.search")}
            aria-label={t("library.search.label")}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setPos(START);
            }}
          />
          <kbd className="caps">esc</kbd>
        </label>
        <button type="button" className="library__close" aria-label={t("library.close")} onClick={close}>
          <Icon name="cross" />
        </button>
      </header>

      <div ref={scrollRef} className="library__scroll">
        {total > 0 ? (
          <div className="library__body">
            {sections.map((section, s) => (
              <section key={section.category.id} className="lib-section" style={{ "--tone": toneVar(section.category.tone) } as CSSProperties} aria-label={section.label}>
                <h2 className="lib-section__head">
                  <i className="lib-section__dot" />
                  <span className="lib-section__name">{section.label}</span>
                  <span className="caps">{plural("library.count", section.apps.length)}</span>
                </h2>
                <div className="lib-grid" role="listbox" aria-label={section.label} style={gridStyle}>
                  {section.apps.map((app, i) => (
                    <AppCell
                      key={app.id}
                      ref={(el) => {
                        if (el) cellRefs.current.set(app.id, el);
                        else cellRefs.current.delete(app.id);
                      }}
                      app={app}
                      selected={s === pos.section && i === pos.index}
                      running={running.has(app.id)}
                      fresh={fresh.has(app.id)}
                      onOpen={open}
                      onContext={(a, e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        useDockStore.getState().setMenu({ key: `app:${a.id}`, at: anchorPoint({ x: r.left, y: r.top, w: r.width, h: r.height }, edge) });
                      }}
                      onHover={() => setPos({ section: s, index: i })}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="library__empty">
            <EmptyGlyph size={64} />
            <p className="library__empty-title">{apps.length === 0 ? t("library.none.title") : t("library.empty.title", { query: query.trim() })}</p>
            <p className="library__empty-hint">{apps.length === 0 ? t("library.none.hint") : t("library.empty.hint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
