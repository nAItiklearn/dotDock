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

const DASH_HEIGHT = 18;

/** Designed state for a widget with no live data. Never a blank or a spinner. */
export function WidgetNotice({ title, issue }: { readonly title: string; readonly issue: ProviderIssue | null }) {
  return (
    <div className="widget-notice">
      <Caps>{title}</Caps>
      <DotMatrix className="widget-notice__dash" text="--" matrixStyle="dots" height={DASH_HEIGHT} label="" />
      <span className="widget-notice__text">{issue ? COPY[issue] : "Waiting for data"}</span>
    </div>
  );
}
