import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppCell } from "./AppCell";
import { actions } from "./bridge";
import { EmptyGlyph } from "./EmptyGlyph";
import { anchorPoint, placeBesideDock, popoverSize, POPOVER, type Rect } from "./geometry";
import { appsInCategory } from "./model";
import { filterApps, isNavKey, moveInGrid, nextQuery } from "./nav";
import { markOpenPainted } from "./openMarks";
import type { CategoryId, DockApp, DockWindow } from "./protocol";
import { useDockStore, type OpenStack } from "./store";
import { categoryLabel, plural, t } from "./strings";
import { toneVar } from "./tones";
import { useViewport } from "./useViewport";
import "./panels.css";

const NO_WINDOWS: readonly DockWindow[] = [];
const HIDDEN_AT: Rect = { x: 0, y: 0, w: 0, h: 0 };

/**
 * The stacks the dock keeps ready. Each one is laid out and painted before anyone asks for it and stays mounted
 * when closed, hidden; opening one only flips it visible, so it appears in the first frame after the press.
 */
export function StackLayer({ categories, open }: { readonly categories: readonly CategoryId[]; readonly open: OpenStack | null }) {
  return (
    <>
      {categories.map((category) => (
        <StackPopover key={category} category={category} open={open?.category === category ? open : null} />
      ))}
    </>
  );
}

/**
 * The grid of a category. Arrow keys move, typing filters, Enter opens, Esc clears the filter and then closes.
 * While it is closed it keeps its content and listens for nothing.
 */
const StackPopover = memo(function StackPopover({ category: id, open }: { readonly category: CategoryId; readonly open: OpenStack | null }) {
  const isOpen = open !== null;
  const category = useDockStore((s) => s.categories.find((c) => c.id === id));
  const allApps = useDockStore((s) => s.apps);
  // Running dots only matter while the popover is showing; a closed one does not re-render for window changes.
  const windows = useDockStore((s) => (isOpen ? s.windows : NO_WINDOWS));
  const viewport = useViewport();

  const apps = useMemo(() => appsInCategory(allApps, id), [allApps, id]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const shown = useMemo(() => filterApps(apps, query), [apps, query]);
  const running = useMemo(() => new Set(windows.flatMap((w) => (w.appId === null ? [] : [w.appId]))), [windows]);
  const fresh = open?.fresh;

  const anchor = useRef<Rect>(HIDDEN_AT);
  if (open) anchor.current = open.from;
  const size = popoverSize(apps.length);
  const pos = placeBesideDock(anchor.current, size, viewport, POPOVER.gap);
  const label = category ? categoryLabel(category) : "";
  const tone = category?.tone ?? "neutral";

  const gridRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  /** Whether the grid has been scrolled since it was last at the top. Reading scroll positions forces a layout, so nothing reads them speculatively. */
  const scrolled = useRef(false);

  useLayoutEffect(() => {
    if (isOpen) markOpenPainted("stack");
  }, [isOpen]);

  // Closing resets it, so the next opening starts clean and the popover is ready for it now.
  useEffect(() => {
    if (isOpen) return;
    setQuery("");
    setSelected(0);
    if (scrolled.current && gridRef.current) gridRef.current.scrollTop = 0;
    scrolled.current = false;
  }, [isOpen]);

  const close = (): void => useDockStore.getState().openStack(null);
  const launch = (app: DockApp): void => {
    close();
    void actions.open(app);
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (useDockStore.getState().menu !== null) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (query !== "") {
          setQuery("");
          setSelected(0);
        } else close();
        return;
      }
      if (isNavKey(e.key)) {
        e.preventDefault();
        const to = moveInGrid(selected, e.key as Parameters<typeof moveInGrid>[1], size.cols, shown.length);
        setSelected(to);
        const target = shown[to];
        if (target) cellRefs.current.get(target.id)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter") {
        const app = shown[selected];
        if (app) {
          e.preventDefault();
          launch(app);
        }
        return;
      }
      const next = nextQuery(query, e);
      if (next !== null) {
        e.preventDefault();
        setQuery(next);
        setSelected(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const panelStyle = {
    transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
    width: size.w,
    height: size.h,
    "--tone": toneVar(tone),
    "--pop-pad": `${POPOVER.pad}px`,
    "--pop-head": `${POPOVER.header}px`,
    "--cell-gap": `${POPOVER.cellGap}px`,
    "--cell-w": `${POPOVER.cellW}px`,
    "--cell-h": `${POPOVER.cellH}px`,
    "--cell-face": `${POPOVER.face}px`,
  } as CSSProperties;
  const gridStyle = { gridTemplateColumns: `repeat(${size.cols}, ${POPOVER.cellW}px)` } as CSSProperties;

  return (
    <div className="popover" role="dialog" aria-label={label} style={panelStyle} data-open={isOpen ? "true" : "false"} aria-hidden={!isOpen}>
      <div className="popover__plate" />
      <div className="popover__content">
        <header className="popover__head">
          <i className="popover__dot" />
          <h2 className="popover__title">{label}</h2>
          {query === "" ? (
            <span className="popover__meta caps">{apps.length > 1 ? t("stack.filter") : plural("library.count", apps.length)}</span>
          ) : (
            <span className="popover__query" aria-live="polite">
              {query}
            </span>
          )}
        </header>
        {shown.length > 0 ? (
          <div
            ref={gridRef}
            className="popover__grid"
            role="listbox"
            aria-label={label}
            style={gridStyle}
            data-scrolls={size.scrolls ? "true" : undefined}
            onScroll={() => {
              scrolled.current = true;
            }}
          >
            {shown.map((app, i) => (
              <AppCell
                key={app.id}
                ref={(el) => {
                  if (el) cellRefs.current.set(app.id, el);
                  else cellRefs.current.delete(app.id);
                }}
                app={app}
                selected={isOpen && i === selected}
                running={running.has(app.id)}
                fresh={fresh?.has(app.id) ?? false}
                onOpen={launch}
                onContext={(a, e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  useDockStore.getState().setMenu({ key: `app:${a.id}`, at: anchorPoint({ x: r.left, y: r.top, w: r.width, h: r.height }) });
                }}
                onHover={() => setSelected(i)}
              />
            ))}
          </div>
        ) : (
          <div className="popover__empty">
            <EmptyGlyph size={44} />
            <p>{apps.length === 0 ? t("stack.empty.title") : t("stack.nomatch", { query })}</p>
            {apps.length === 0 ? <p className="popover__hint">{t("stack.empty.hint")}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
});
