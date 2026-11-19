import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Icon } from "../design-system/Icon";
import { actions } from "./bridge";
import { MENU, metricsFor, placeMenu, type Point } from "./geometry";
import { actionable, heightBefore, menuFor, menuSize, type MenuActions, type MenuContext, type MenuItem } from "./menu";
import { useDockStore, type MenuTarget } from "./store";
import { toneVar } from "./tones";
import { useViewport } from "./useViewport";
import "./panels.css";

function useMenuContext(): MenuContext {
  const settings = useDockStore((s) => s.settings);
  const categories = useDockStore((s) => s.categories);
  const apps = useDockStore((s) => s.apps);
  const windows = useDockStore((s) => s.windows);
  const editing = useDockStore((s) => s.editing);
  return useMemo(() => {
    const store = useDockStore.getState();
    const act: MenuActions = {
      launch: (appId, name) => void actions.launch(appId, name),
      closeWindows: (hwnds) => void actions.closeWindows(hwnds),
      setCategory: (appId, category) => void actions.setCategory(appId, category),
      updateSettings: (patch) => void actions.updateSettings(patch),
      openStack: (category) => {
        const el = document.querySelector<HTMLElement>(`[data-key="stack:${CSS.escape(category)}"] .disc`);
        const r = el?.getBoundingClientRect();
        if (r) store.openStack({ category, from: { x: r.left, y: r.top, w: r.width, h: r.height } });
      },
      setLibrary: store.setLibrary,
      setEditing: store.setEditing,
    };
    return { settings, categories, apps, windows, editing, do: act };
  }, [settings, categories, apps, windows, editing]);
}

function Rows({
  items,
  active,
  onActive,
  onRun,
  openSub,
}: {
  readonly items: readonly MenuItem[];
  readonly active: number;
  readonly onActive: (index: number) => void;
  readonly onRun: (item: MenuItem) => void;
  readonly openSub?: string | null;
}) {
  return (
    <>
      {items.map((item, i) => {
        if (item.kind === "separator") return <hr key={item.id} className="menu__separator" />;
        if (item.kind === "heading") {
          return (
            <div key={item.id} className="menu__heading caps" role="presentation">
              {item.label}
            </div>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
            aria-checked={item.checked}
            aria-haspopup={item.kind === "submenu" ? "menu" : undefined}
            aria-expanded={item.kind === "submenu" ? openSub === item.id : undefined}
            className="menu__item"
            data-active={i === active ? "true" : undefined}
            data-danger={item.danger ? "true" : undefined}
            onPointerEnter={() => onActive(i)}
            onClick={() => onRun(item)}
          >
            {item.tone ? <i className="menu__dot" style={{ "--tone": toneVar(item.tone) } as CSSProperties} /> : null}
            <span className="menu__label">{item.label}</span>
            {item.checked ? <Icon name="check" /> : null}
            {item.kind === "submenu" ? <Icon name="chevron-right" /> : null}
          </button>
        );
      })}
    </>
  );
}

/** The menu of an item (or of the bar). Arrow keys move, Enter runs, Right opens a submenu, Esc closes. */
export function ContextMenu({ target }: { readonly target: MenuTarget }) {
  const ctx = useMenuContext();
  const edge = useDockStore((s) => s.settings.edge);
  const iconSize = useDockStore((s) => s.settings.iconSize);
  const viewport = useViewport();
  const items = useMemo(() => menuFor(target.key, ctx), [target.key, ctx]);
  const stops = useMemo(() => actionable(items), [items]);
  const [active, setActive] = useState(stops[0] ?? -1);
  const [sub, setSub] = useState<string | null>(null);
  const [subActive, setSubActive] = useState(-1);

  const close = (): void => useDockStore.getState().setMenu(null);
  const run = (item: MenuItem): void => {
    if (item.kind === "submenu") {
      setSub(item.id);
      return;
    }
    close();
    item.run?.();
  };

  const parentIndex = sub === null ? -1 : items.findIndex((i) => i.id === sub);
  const children = parentIndex >= 0 ? (items[parentIndex]?.children ?? []) : [];
  const childStops = actionable(children);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inSub = sub !== null;
      const list = inSub ? children : items;
      const keyStops = inSub ? childStops : stops;
      const current = inSub ? subActive : active;
      const set = inSub ? setSubActive : setActive;
      const at = keyStops.indexOf(current);
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          if (inSub) setSub(null);
          else close();
          return;
        case "ArrowDown":
        case "ArrowUp": {
          e.preventDefault();
          const step = e.key === "ArrowDown" ? 1 : -1;
          const next = keyStops[(at + step + keyStops.length) % keyStops.length];
          if (next !== undefined) set(next);
          return;
        }
        case "Home":
        case "End": {
          e.preventDefault();
          const next = e.key === "Home" ? keyStops[0] : keyStops[keyStops.length - 1];
          if (next !== undefined) set(next);
          return;
        }
        case "ArrowRight": {
          const item = items[active];
          if (!inSub && item?.kind === "submenu") {
            e.preventDefault();
            setSub(item.id);
            setSubActive(actionable(item.children ?? [])[0] ?? -1);
          }
          return;
        }
        case "ArrowLeft":
          if (inSub) {
            e.preventDefault();
            setSub(null);
          }
          return;
        case "Enter":
        case " ": {
          e.preventDefault();
          const item = list[current];
          if (item) run(item);
          return;
        }
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const vars = {
    "--menu-pad": `${MENU.pad}px`,
    "--menu-row": `${MENU.row}px`,
    "--menu-heading": `${MENU.heading}px`,
    "--menu-sep": `${MENU.separator}px`,
  } as CSSProperties;
  const size = menuSize(items);
  const pos = placeMenu(target.at, size, edge, viewport, target.key === null ? MENU.gap : metricsFor(iconSize).pad + MENU.gap * 2);
  const subSize = menuSize(children);
  const opensLeft = pos.x + size.w + MENU.gap + subSize.w > viewport.w - 12;
  const subPos: Point = {
    x: opensLeft ? pos.x - MENU.gap - subSize.w : pos.x + size.w + MENU.gap,
    y: Math.max(12, Math.min(pos.y + MENU.pad + heightBefore(items, parentIndex) - MENU.pad, viewport.h - 12 - subSize.h)),
  };

  return (
    <>
      <div className="menu" role="menu" data-edge={edge} style={{ left: pos.x, top: pos.y, width: size.w, ...vars }}>
        <Rows
          items={items}
          active={active}
          openSub={sub}
          onActive={(i) => {
            setActive(i);
            const item = items[i];
            if (item?.kind === "submenu") {
              setSub(item.id);
              setSubActive(-1);
            } else setSub(null);
          }}
          onRun={run}
        />
      </div>
      {sub !== null ? (
        <div className="menu menu--sub" role="menu" data-edge={edge} style={{ left: subPos.x, top: subPos.y, width: subSize.w, ...vars }}>
          <Rows items={children} active={subActive} onActive={setSubActive} onRun={run} />
        </div>
      ) : null}
    </>
  );
}
