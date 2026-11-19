import { getApp } from "../../lib/state/app";
import { IconButton } from "../../lib/ui/controls";
import { Icon } from "../../lib/ui/Icon";
import { announce } from "../editUi";
import "./edit.css";

export interface SlotChromeProps {
  readonly id: string;
  readonly name: string;
  readonly selected: boolean;
  readonly locked: boolean;
  /** True when the widget declares more than one size. */
  readonly resizable: boolean;
}

/** What a widget wears in edit mode: an outline, quick actions and a corner resize handle. All inside its own box. */
export function SlotChrome({ id, name, selected, locked, resizable }: SlotChromeProps) {
  const layout = getApp().layout;
  return (
    <>
      <div className={`slot-chrome__frame${selected ? " is-selected" : ""}`} aria-hidden="true" />
      {locked ? (
        <span className="slot-chrome__lock" aria-hidden="true">
          <Icon name="lock" size={14} />
        </span>
      ) : (
        <>
          <div className="slot-chrome__actions" data-no-drag>
            <IconButton
              icon="duplicate"
              label={`Duplicate ${name}`}
              onClick={() => {
                const result = layout.getState().duplicate(id);
                if (result.ok) announce(`${name} duplicated`);
              }}
            />
            <IconButton
              icon="trash"
              tone="danger"
              label={`Remove ${name}`}
              onClick={() => {
                if (layout.getState().remove(id).ok) announce(`${name} removed`);
              }}
            />
          </div>
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
