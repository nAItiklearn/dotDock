import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, usePresence } from "motion/react";
import { AppCell } from "./AppCell";
import { actions } from "./bridge";
import { EmptyGlyph } from "./EmptyGlyph";
import { anchorPoint, placeBesideDock, popoverSize, POPOVER } from "./geometry";
import { appsInCategory, freshAppIds } from "./model";
import { filterApps, isNavKey, moveInGrid, nextQuery } from "./nav";
import type { DockApp } from "./protocol";
import { PANEL_SETTLE_MS, springFor } from "./spring";
import { useDockStore, type OpenStack } from "./store";
import { categoryLabel, plural, t } from "./strings";
import { toneVar } from "./tones";
import { useViewport } from "./useViewport";
import "./panels.css";

const CONTENT_FADE_FROM = 0.4;
const CONTENT_FADE_SPAN = 0.45;

function useRadius(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--radius-md")) || 0;
}

/**
 * The grid of a category, grown out of its tile: the plate springs from the tile's rect to its own, with its
 * corners kept round, and the content fades in once there is room. Arrow keys move, typing filters, Enter opens.
 */
export function StackPopover({ stack }: { readonly stack: OpenStack }) {
  const category = useDockStore((s) => s.categories.find((c) => c.id === stack.category));
  const allApps = useDockStore((s) => s.apps);
  const windows = useDockStore((s) => s.windows);
  const edge = useDockStore((s) => s.settings.edge);
  const viewport = useViewport();
  const reduced = useReducedMotion() ?? false;
  const radius = useRadius();
  const [present, safeToRemove] = usePresence();

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

  // Shared-element growth: a scale and shift that carry the plate from the tile's rect to its own.
  const from = stack.from;
  const sx0 = Math.max(from.w / size.w, 0.01);
  const sy0 = Math.max(from.h / size.h, 0.01);
  const tx0 = from.x + from.w / 2 - (pos.x + size.w / 2);
  const ty0 = from.y + from.h / 2 - (pos.y + size.h / 2);
  const progress = useMotionValue(reduced ? 1 : 0);
  const scaleX = useTransform(progress, (v) => sx0 + (1 - sx0) * v);
  const scaleY = useTransform(progress, (v) => sy0 + (1 - sy0) * v);
  const x = useTransform(progress, (v) => tx0 * (1 - v));
  const y = useTransform(progress, (v) => ty0 * (1 - v));
  const borderRadius = useTransform(() => `${radius / scaleX.get()}px / ${radius / scaleY.get()}px`);
  const contentOpacity = useTransform(progress, (v) => Math.min(1, Math.max(0, (v - CONTENT_FADE_FROM) / CONTENT_FADE_SPAN)));

  useEffect(() => {
    if (reduced) {
      progress.set(1);
      return undefined;
    }
    const controls = animate(progress, 1, springFor(PANEL_SETTLE_MS.open));
    return () => controls.stop();
  }, [progress, reduced]);

  useEffect(() => {
    if (present) return undefined;
    if (reduced) {
      safeToRemove();
      return undefined;
    }
    const controls = animate(progress, 0, { ...springFor(PANEL_SETTLE_MS.close), onComplete: safeToRemove });
    return () => controls.stop();
  }, [present, progress, reduced, safeToRemove]);

  const gridRef = useRef<HTMLDivElement>(null);
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
    if (!present) return undefined;
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
      <motion.div className="popover__plate" style={{ x, y, scaleX, scaleY, borderRadius }} />
      <motion.div className="popover__content" style={{ opacity: contentOpacity }}>
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
          <div ref={gridRef} className="popover__grid" role="listbox" aria-label={label} style={gridStyle} data-scrolls={size.scrolls ? "true" : undefined}>
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
      </motion.div>
    </div>
  );
}

