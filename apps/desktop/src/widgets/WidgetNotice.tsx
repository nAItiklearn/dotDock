import { DotMatrix } from "../design-system/DotMatrix";
import { Caps } from "../design-system/primitives";
import type { ProviderIssue } from "../providers/types";
import "./WidgetNotice.css";

const COPY: Record<ProviderIssue, string> = {
  unsupported: "Not available here",
  "no-device": "No battery",
  offline: "Offline",
  error: "Can't read data",
  "needs-setup": "Set a city",
};

const DASH_HEIGHT = 14;

export interface WidgetNoticeProps {
  readonly title: string;
  readonly issue: ProviderIssue | null;
  /** One-row layout for pill widgets. */
  readonly compact?: boolean;
}

/** Designed state for a widget with no live data. Never a blank or a spinner. */
export function WidgetNotice({ title, issue, compact = false }: WidgetNoticeProps) {
  return (
    <div className={`widget-notice${compact ? " widget-notice--compact" : ""}`}>
      <DotMatrix className="widget-notice__dash" text="--" matrixStyle="blocks" height={DASH_HEIGHT} label="" />
      <Caps>{title}</Caps>
      <span className="widget-notice__text">{issue ? COPY[issue] : "Waiting for data"}</span>
    </div>
  );
}
