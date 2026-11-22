import { getApp } from "../../lib/state/app";
import { Icon } from "../../lib/ui/Icon";
import { removeWithExit } from "../directActions";
import "./edit.css";

export interface SlotChromeProps {
  readonly id: string;
  readonly name: string;
  readonly selected: boolean;
  readonly locked: boolean;
  /** True when the widget declares more than one size. */
  readonly resizable: boolean;
}

/**
 * What a widget wears in edit mode: an outline on its edge, a small remove button in the top-left
 * corner and a resize handle in the bottom-right one. All inside its own box, so all inside its hit area.
 */
export function SlotChrome({ id, name, selected, locked, resizable }: SlotChromeProps) {
  return (
    <>
      <div className={`slot-chrome__frame${selected ? " is-selected" : ""}`} aria-hidden="true" />
      {locked ? (
        <span className="slot-chrome__lock" aria-hidden="true">
          <Icon name="lock" size={14} />
        </span>
      ) : (
        <>
          <button
            type="button"
            className="slot-chrome__remove"
            data-no-drag
            aria-label={`Remove ${name}`}
            title={`Remove ${name}`}
            onClick={() => void removeWithExit(getApp().layout, id, name)}
          >
            <Icon name="close" size={12} />
          </button>
          {resizable ? (
            <span className="slot-chrome__resize" data-resize-handle aria-hidden="true">
              <Icon name="resize" size={16} />
            </span>
          ) : null}
        </>
      )}
    </>
  );
}
