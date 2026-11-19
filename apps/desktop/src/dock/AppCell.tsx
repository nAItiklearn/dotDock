import { forwardRef, memo, useState, type MouseEvent } from "react";
import type { DockApp } from "./protocol";
import "./cells.css";
import { t } from "./strings";

export interface AppCellProps {
  readonly app: DockApp;
  readonly selected: boolean;
  readonly running: boolean;
  readonly fresh: boolean;
  readonly onOpen: (app: DockApp) => void;
  readonly onContext: (app: DockApp, event: MouseEvent<HTMLElement>) => void;
  readonly onHover: () => void;
}

/** One app in a grid: the stack popover and the App Library draw it the same way at different sizes. */
export const AppCell = memo(
  forwardRef<HTMLButtonElement, AppCellProps>(function AppCell({ app, selected, running, fresh, onOpen, onContext, onHover }, ref) {
    const [failed, setFailed] = useState(false);
    return (
      <button
        ref={ref}
        type="button"
        role="option"
        aria-selected={selected}
        className="cell"
        data-selected={selected ? "true" : undefined}
        data-running={running ? "true" : undefined}
        tabIndex={-1}
        onClick={() => onOpen(app)}
        onContextMenu={(e) => {
          e.preventDefault();
          onContext(app, e);
        }}
        onPointerMove={onHover}
      >
        <span className="cell__face">
          {failed || app.icon === "" ? (
            <span className="art art--missing" aria-hidden="true">
              {app.name.trim().charAt(0).toUpperCase()}
            </span>
          ) : (
            <img className="art" src={app.icon} alt="" draggable={false} decoding="async" onError={() => setFailed(true)} />
          )}
          {fresh ? <i className="badge" aria-label={t("item.new")} /> : null}
        </span>
        <span className="cell__name">{app.name}</span>
        {running ? <i className="cell__running" aria-hidden="true" /> : null}
      </button>
    );
  }),
);
