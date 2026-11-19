import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppCell } from "./AppCell";
import { actions } from "./bridge";
import { EmptyGlyph } from "./EmptyGlyph";
import { anchorPoint, placeBesideDock, popoverSize, POPOVER } from "./geometry";
import { appsInCategory, freshAppIds } from "./model";
import { filterApps, isNavKey, moveInGrid, nextQuery } from "./nav";
import type { DockApp } from "./protocol";
import { useDockStore, type OpenStack } from "./store";
import { categoryLabel, plural, t } from "./strings";
import { toneVar } from "./tones";
import { useViewport } from "./useViewport";
import "./panels.css";

/**
 * The grid of a category. It opens in the same frame as the click, fully laid out: no growth animation delays
 * the content (only a short opacity fade, see panels.css), and closing is immediate. Arrow keys move, typing
 * filters, Enter opens, Esc clears the filter and then closes.
 */
export function StackPopover({ stack }: { readonly stack: OpenStack }) {
  const category = useDockStore((s) => s.categories.find((c) => c.id === stack.category));
  const allApps = useDockStore((s) => s.apps);
  const windows = useDockStore((s) => s.windows);
  const edge = useDockStore((s) => s.settings.edge);
  const viewport = useViewport();

  const apps = useMemo(() => appsInCategory(allApps, stack.category), [allApps, stack.category]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const shown = useMemo(() => filterApps(apps, query), [apps, query]);
  // The badge shows what was new when the stack opened, even though opening it marks those apps as seen.
  const seenAtOpen = useRef(useDockStore.getState().seen);
  const fresh = useMemo(() => freshAppIds(apps, seenAtOpen.current, Date.now()), [apps]);
  const running = useMemo(() => new Set(windows.flatMap((w) => (w.appId === null ? [] : [w.appId]))), [windows]);

  const size = popoverSize(apps.length);
  const pos = placeBesideDock(stack.from, size, edge, viewport, POPOVER.gap);
  const label = category ? categoryLabel(category) : "";
  const tone = category?.tone ?? "neutral";

  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const app = shown[selected];
    if (app) cellRefs.current.get(app.id)?.scrollIntoView({ block: "nearest" });
  }, [selected, shown]);

  const close = (): void => useDockStore.getState().openStack(null);
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
          setSelected(0);
        } else close();
        return;
      }
      if (isNavKey(e.key)) {
        e.preventDefault();
        setSelected((index) => moveInGrid(index, e.key as Parameters<typeof moveInGrid>[1], size.cols, shown.length));
        return;
      }
      if (e.key === "Enter") {
        const app = shown[selected];
        if (app) {
          e.preventDefault();
          open(app);
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
    left: pos.x,
    top: pos.y,
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
    <div className="popover" role="dialog" aria-label={label} style={panelStyle} data-edge={edge}>
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
          <div className="popover__grid" role="listbox" aria-label={label} style={gridStyle} data-scrolls={size.scrolls ? "true" : undefined}>
            {shown.map((app, i) => (
              <AppCell
                key={app.id}
                ref={(el) => {
                  if (el) cellRefs.current.set(app.id, el);
                  else cellRefs.current.delete(app.id);
                }}
                app={app}
                selected={i === selected}
                running={running.has(app.id)}
                fresh={fresh.has(app.id)}
                onOpen={open}
                onContext={(a, e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  useDockStore.getState().setMenu({ key: `app:${a.id}`, at: anchorPoint({ x: r.left, y: r.top, w: r.width, h: r.height }, edge) });
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
}
