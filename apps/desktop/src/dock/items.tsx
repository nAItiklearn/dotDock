import { memo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../design-system/Icon";
import { LibraryMark } from "./DockIcons";
import { lengthOf } from "./geometry";
import { indicatorFor, lengthKind, magnifies, type AppEntry, type BarEntry, type StackEntry } from "./model";
import { t } from "./strings";
import { StatusPill, Tile } from "./tiles";
import { toneVar } from "./tones";

/** What a slot can ask of the bar. The bar keeps these stable so slots only re-render when their entry changes. */
export interface SlotHandlers {
  readonly activate: (entry: BarEntry, face: HTMLElement) => void;
  readonly context: (entry: BarEntry, event: MouseEvent | KeyboardEvent, face: HTMLElement) => void;
  readonly remove: (entry: BarEntry) => void;
  readonly focused: (key: string) => void;
  readonly pointerDown: (entry: BarEntry, event: ReactPointerEvent<HTMLElement>) => void;
}

export interface SlotProps {
  readonly entry: BarEntry;
  readonly icon: number;
  readonly vertical: boolean;
  readonly editing: boolean;
  /** The one item that is a tab stop; arrow keys move it. */
  readonly roving: boolean;
  /** This entry's popover is open. */
  readonly open: boolean;
  readonly handlers: SlotHandlers;
}

/** Whether an entry can be dragged in edit mode. */
export const isDraggable = (entry: BarEntry): boolean => (entry.kind === "app" && entry.pinned) || entry.kind === "stack" || entry.kind === "tile";

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

export const entryLabel = label;

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

function Face({ entry, editing, roving, open, handlers }: Omit<SlotProps, "icon" | "vertical">) {
  const name = label(entry);
  const removable = editing && isRemovable(entry);
  const draggable = editing && isDraggable(entry);
  const common = {
    tabIndex: roving ? 0 : -1,
    onFocus: () => handlers.focused(entry.key),
  } as const;

  if (entry.kind === "divider") {
    return (
      <div className="face face--divider" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    );
  }
  if (entry.kind === "status") {
    return (
      <div className="face face--status">
        <StatusPill />
      </div>
    );
  }
  if (entry.kind === "tile") {
    return (
      <div className="face face--tile" data-editing={editing ? "true" : undefined} onPointerDown={draggable ? (e) => handlers.pointerDown(entry, e) : undefined}>
        <Tile id={entry.id} />
        {removable ? <RemoveBadge name={name} onRemove={() => handlers.remove(entry)} /> : null}
      </div>
    );
  }

  const running = entry.kind === "app" && entry.windows.length > 0;
  const aria = entry.kind === "app" && running ? `${entry.name}, ${t(entry.windows.length === 1 ? "item.running.one" : "item.running.other", { count: entry.windows.length })}` : name;
  const style = entry.kind === "stack" ? ({ "--tone": toneVar(entry.category.tone) } as CSSProperties) : undefined;
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
          }
        }}
        onPointerDown={draggable ? (e) => handlers.pointerDown(entry, e) : undefined}
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

/** One place on the bar: a layout box the engine measures, holding the face it scales and the dots it only moves. */
export const Slot = memo(function Slot({ entry, icon, vertical, editing, roving, open, handlers }: SlotProps) {
  const kind = lengthKind(entry);
  const style = { "--len": kind === "status" ? "auto" : `${lengthOf(kind, icon, vertical)}px` } as CSSProperties;
  return (
    <div
      className="slot"
      data-key={entry.key}
      data-kind={entry.kind}
      data-tile={entry.kind === "tile" ? entry.id : undefined}
      data-magnify={magnifies(entry) ? "true" : "false"}
      style={style}
      role="presentation"
    >
      <Face entry={entry} editing={editing} roving={roving} open={open} handlers={handlers} />
      {entry.kind === "app" ? <Dots entry={entry} /> : null}
      {entry.kind === "stack" && entry.running > 0 ? (
        <span className="dots dots--stack" aria-hidden="true">
          <i />
        </span>
      ) : null}
    </div>
  );
});

