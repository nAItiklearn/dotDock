import { memo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../design-system/Icon";
import { LibraryMark } from "./DockIcons";
import { faceBox, lengthOf, renderScale } from "./geometry";
import type { DockEdge } from "./protocol";
import { indicatorFor, lengthKind, magnifyWeight, type AppEntry, type BarEntry, type StackEntry } from "./model";
import { plural, t } from "./strings";
import { StatusPill, Tile } from "./tiles";
import { toneVar } from "./tones";

/** What a slot can ask of the bar. The bar keeps these stable so slots only re-render when their entry changes. */
export interface SlotHandlers {
  /** A click or a key press: opens panels that did not already open on the press, launches apps. */
  readonly activate: (entry: BarEntry, face: HTMLElement) => void;
  /** The primary button going down on an item that opens a panel: the panel opens now, not when the button comes back up. */
  readonly press: (entry: BarEntry, face: HTMLElement, event: ReactPointerEvent<HTMLElement>) => void;
  /** A key that opens a panel, on key down. */
  readonly pressKey: (entry: BarEntry, face: HTMLElement, event: KeyboardEvent<HTMLElement>) => void;
  readonly context: (entry: BarEntry, event: MouseEvent | KeyboardEvent, face: HTMLElement) => void;
  readonly remove: (entry: BarEntry) => void;
  readonly focused: (key: string) => void;
  readonly pointerDown: (entry: BarEntry, event: ReactPointerEvent<HTMLElement>) => void;
}

export interface SlotProps {
  readonly entry: BarEntry;
  readonly icon: number;
  readonly vertical: boolean;
  readonly edge: DockEdge;
  readonly editing: boolean;
  /** The one item that is a tab stop; arrow keys move it. */
  readonly roving: boolean;
  /** The dock's peak magnification: faces are drawn this much larger and shown scaled down, so magnifying never upsamples. */
  readonly peak: number;
  /** This entry's popover is open. */
  readonly open: boolean;
  readonly handlers: SlotHandlers;
}

/** Whether an entry can be dragged in edit mode. */
export const isDraggable = (entry: BarEntry): boolean => (entry.kind === "app" && entry.pinned) || entry.kind === "stack" || entry.kind === "tile";

/** Items that open a panel: it opens on the press, ahead of the click, so the dock answers as fast as the hand moves. */
export const opensPanel = (entry: BarEntry): boolean => entry.kind === "stack" || entry.kind === "library" || entry.kind === "add";

/** Whether edit mode shows a remove badge on an entry. */
export const isRemovable = isDraggable;

function AppArt({ icon, name }: { readonly icon: string; readonly name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || icon === "") {
    return (
      <span className="art art--missing" aria-hidden="true">
        {name.trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return <img className="art" src={icon} alt="" draggable={false} decoding="async" onError={() => setFailed(true)} />;
}

function Dots({ entry }: { readonly entry: AppEntry }) {
  const { dots, focused, attention } = indicatorFor(entry.windows);
  if (dots === 0) return null;
  return (
    <span className="dots" data-focused={focused ? "true" : undefined} data-attention={attention ? "true" : undefined} aria-hidden="true">
      <i />
      {dots === 2 ? <i /> : null}
    </span>
  );
}

function label(entry: BarEntry): string {
  switch (entry.kind) {
    case "app":
      return entry.name;
    case "stack":
      return entry.label;
    case "library":
      return t("library.open");
    case "tile":
      return t(`tile.${entry.id}`);
    case "add":
      return t("edit.add");
    default:
      return "";
  }
}


function StackMini({ entry }: { readonly entry: StackEntry }) {
  const cells = Array.from({ length: 4 }, (_, i) => entry.preview[i]);
  return (
    <span className="stack-grid" aria-hidden="true">
      {cells.map((app, i) =>
        app ? <img key={app.id} className="art art--mini" src={app.icon} alt="" draggable={false} decoding="async" /> : <i key={i} className="stack-grid__empty" />,
      )}
    </span>
  );
}

function Face({ entry, editing, roving, open, handlers, box }: Omit<SlotProps, "icon" | "vertical" | "peak" | "edge"> & { readonly box: CSSProperties | undefined }) {
  const name = label(entry);
  const removable = editing && isRemovable(entry);
  const draggable = editing && isDraggable(entry);
  const opensOnPress = !editing && opensPanel(entry);
  const common = {
    tabIndex: roving ? 0 : -1,
    onFocus: () => handlers.focused(entry.key),
  } as const;

  if (entry.kind === "divider") {
    return (
      <div className="face face--divider" aria-hidden="true" style={box}>
        <i />
        <i />
        <i />
      </div>
    );
  }
  if (entry.kind === "status") {
    return (
      <div className="face face--status" style={box}>
        <StatusPill />
      </div>
    );
  }
  if (entry.kind === "tile") {
    return (
      <div className="face face--tile" style={box} data-editing={editing ? "true" : undefined} onPointerDown={draggable ? (e) => handlers.pointerDown(entry, e) : undefined}>
        <Tile id={entry.id} />
        {removable ? <RemoveBadge name={name} onRemove={() => handlers.remove(entry)} /> : null}
      </div>
    );
  }

  const running = entry.kind === "app" && entry.windows.length > 0;
  const aria = entry.kind === "app" && running ? `${entry.name}, ${t(entry.windows.length === 1 ? "item.running.one" : "item.running.other", { count: entry.windows.length })}` : name;
  const style = entry.kind === "stack" ? ({ ...box, "--tone": toneVar(entry.category.tone) } as CSSProperties) : box;
  return (
    <div className="face" data-editing={editing ? "true" : undefined} data-open={open ? "true" : undefined} style={style}>
      <button
        type="button"
        className={`disc${entry.kind === "stack" ? " disc--stack" : ""}${entry.kind === "library" ? " disc--library" : ""}${entry.kind === "add" ? " disc--add" : ""}`}
        aria-label={aria}
        aria-haspopup={entry.kind === "stack" || entry.kind === "add" ? "dialog" : undefined}
        aria-expanded={entry.kind === "stack" || entry.kind === "add" ? open : undefined}
        data-draggable={draggable ? "true" : undefined}
        onClick={(e) => handlers.activate(entry, e.currentTarget)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handlers.context(entry, e, e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
            e.preventDefault();
            handlers.context(entry, e, e.currentTarget);
          } else if (opensOnPress && e.key === " ") {
            e.preventDefault();
            handlers.pressKey(entry, e.currentTarget, e);
          }
        }}
        onKeyUp={opensOnPress ? (e) => e.key === " " && e.preventDefault() : undefined}
        onPointerDown={draggable ? (e) => handlers.pointerDown(entry, e) : opensOnPress ? (e) => handlers.press(entry, e.currentTarget, e) : undefined}
        {...common}
      >
        {entry.kind === "app" ? <AppArt icon={entry.icon} name={entry.name} /> : null}
        {entry.kind === "stack" ? <StackMini entry={entry} /> : null}
        {entry.kind === "library" ? <LibraryMark /> : null}
        {entry.kind === "add" ? <Icon name="plus" /> : null}
      </button>
      {entry.kind === "app" && entry.fresh ? <i className="badge" aria-label={t("item.new")} /> : null}
      {entry.kind === "stack" && entry.fresh > 0 ? (
        <i className="badge" aria-label={t("stack.new.other", { count: entry.fresh })}>
          {entry.fresh > 1 ? entry.fresh : null}
        </i>
      ) : null}
      {removable ? <RemoveBadge name={name} onRemove={() => handlers.remove(entry)} /> : null}
      {entry.kind === "app" ? <Dots entry={entry} /> : null}
      {entry.kind === "stack" && entry.running > 0 ? (
        <span className="dots dots--stack" aria-hidden="true">
          <i />
        </span>
      ) : null}
    </div>
  );
}

function RemoveBadge({ name, onRemove }: { readonly name: string; readonly onRemove: () => void }) {
  return (
    <button type="button" className="remove" aria-label={t("edit.remove", { name })} onClick={onRemove} onPointerDown={(e) => e.stopPropagation()}>
      <Icon name="minus" />
    </button>
  );
}

/**
 * One place on the bar: a layout box the engine measures, holding the face the engine moves and scales. The
 * face is drawn `--r` times larger than the slot (its peak), so the sizes its content needs are set here, once
 * per render, and never redeclared on the face: a face that declares custom properties makes every style
 * recalculation of it re-resolve its whole subtree.
 */
export const Slot = memo(function Slot({ entry, icon, vertical, edge, editing, roving, open, peak, handlers }: SlotProps) {
  const kind = lengthKind(entry);
  const weight = magnifyWeight(entry);
  const render = renderScale(weight, peak);
  const length = kind === "status" ? null : lengthOf(kind, icon, vertical);
  const style = {
    "--len": length === null ? "auto" : `${length}px`,
    "--r": render,
    "--d-icon": `${icon * render}px`,
  } as CSSProperties;
  // The face's own box is plain pixels: a declaration that uses var() is substituted again every time the engine
  // rewrites the face's transform, and there are a dozen faces per frame.
  const box: CSSProperties | undefined = length === null ? undefined : faceBox(edge, length * render, icon * render);
  return (
    <div
      className="slot"
      data-key={entry.key}
      data-kind={entry.kind}
      data-tile={entry.kind === "tile" ? entry.id : undefined}
      data-weight={weight}
      data-name={label(entry)}
      data-sub={entry.kind === "app" && entry.windows.length > 1 ? plural("item.running", entry.windows.length) : ""}
      style={style}
      role="presentation"
    >
      <Face entry={entry} editing={editing} roving={roving} open={open} handlers={handlers} box={box} />
    </div>
  );
});

