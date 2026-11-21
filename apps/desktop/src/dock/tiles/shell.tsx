import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { t } from "../strings";
import type { TileIssue } from "./ui-types";

/** What a tile's face can ask of the bar. The bar supplies them (items.tsx); nothing here knows how a popover opens. */
export interface TileControls {
  readonly editing: boolean;
  /** This tile's popover is open. */
  readonly open: boolean;
  /** The pointer going down: the popover opens now, not when the button comes back up. */
  readonly onPress: (face: HTMLElement, event: ReactPointerEvent<HTMLElement>) => void;
  /** A click or Enter. */
  readonly onActivate: (face: HTMLElement) => void;
  /** Space, on key down. */
  readonly onPressKey: (face: HTMLElement, event: KeyboardEvent<HTMLElement>) => void;
}

export type TileState = "ready" | "pending" | "issue";

export interface TileShellProps {
  readonly id: string;
  /** What a screen reader says for the whole tile: its name and what it shows. */
  readonly label: string;
  readonly state?: TileState;
  /** The tile's own popover, if it has one; without controls the tile is only a display. */
  readonly controls?: TileControls | undefined;
  readonly children: ReactNode;
}

/**
 * The frame every live tile shares: the rounded surface, and a transparent button over all of it that opens the
 * tile's popover. Anything on the tile that does its own job (a Join button, a start button) sits above the
 * button, so buttons are never nested.
 */
export function TileShell({ id, label, state = "ready", controls, children }: TileShellProps) {
  return (
    <div className={`tile tile--${id}`} role="group" aria-label={label} data-state={state} data-open={controls?.open ? "true" : undefined}>
      {controls ? (
        <button
          type="button"
          className="tile__hit"
          tabIndex={-1}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={controls.open}
          onClick={(e) => controls.onActivate(e.currentTarget)}
          onPointerDown={controls.editing ? undefined : (e) => controls.onPress(e.currentTarget, e)}
          onKeyDown={(e) => {
            if (e.key === " " && !controls.editing) {
              e.preventDefault();
              controls.onPressKey(e.currentTarget, e);
            }
          }}
          onKeyUp={(e) => e.key === " " && e.preventDefault()}
        />
      ) : null}
      {children}
    </div>
  );
}

/** One line for a feed that has nothing to show, in the words the home screen's widgets use. */
export function issueText(issue: TileIssue): string {
  return t(`tile.issue.${issue}`);
}

/** The round mark at the left of a tile with words beside it. */
export function Mark({ children, tone }: { readonly children: ReactNode; readonly tone?: "accent" | "danger" | "dim" | undefined }) {
  return (
    <span className="tile__mark" data-tone={tone}>
      {children}
    </span>
  );
}

/** The words beside a tile's mark: a line, and a quieter one under it. */
export function Words({ title, sub, urgent }: { readonly title: string; readonly sub?: string | null | undefined; readonly urgent?: boolean | undefined }) {
  return (
    <span className="tile__text">
      <span className="tile__title">{title}</span>
      {sub ? (
        <span className="tile__sub caps" data-urgent={urgent ? "true" : undefined}>
          {sub}
        </span>
      ) : null}
    </span>
  );
}
