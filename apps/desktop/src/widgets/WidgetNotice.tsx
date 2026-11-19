import { DotIcon } from "../design-system/DotMatrix";
import type { DotIconName } from "../design-system/icons";
import { Caps } from "../design-system/primitives";
import type { ProviderIssue, ProviderState } from "../providers/types";
import "./WidgetNotice.css";

interface IssueCopy {
  readonly icon: DotIconName;
  readonly text: string;
}

const COPY: Record<ProviderIssue, IssueCopy> = {
  unsupported: { icon: "empty", text: "Not available here" },
  "no-device": { icon: "empty", text: "Nothing to show" },
  offline: { icon: "offline", text: "Offline" },
  error: { icon: "alert", text: "Can't read data" },
  "needs-setup": { icon: "plus", text: "Needs setup" },
};

const LOADING: IssueCopy = { icon: "empty", text: "Loading" };
const ICON_SIZE = 27;

export interface WidgetNoticeProps {
  readonly title: string;
  readonly issue: ProviderIssue | null;
  /** Replaces the default line for this issue, e.g. "No battery" or "Set a city". */
  readonly message?: string | undefined;
  /** One-row layout for pill widgets. */
  readonly compact?: boolean;
}

/** Designed state for a widget with no live data. Never a blank and never a spinner. */
export function WidgetNotice({ title, issue, message, compact = false }: WidgetNoticeProps) {
  const copy = issue ? COPY[issue] : LOADING;
  return (
    <div className={`widget-notice${compact ? " widget-notice--compact" : ""}`} role="status">
      <DotIcon className={`widget-notice__icon${issue ? "" : " widget-notice__icon--loading"}`} name={copy.icon} size={ICON_SIZE} />
      <div className="widget-notice__copy">
        <Caps>{title}</Caps>
        <span className="widget-notice__text">{message ?? copy.text}</span>
      </div>
    </div>
  );
}

/** Small corner mark for last-known data: tells the truth without hiding the value. */
export function Freshness({ state }: { readonly state: ProviderState<unknown> }) {
  if (state.data === null) return null;
  const label = state.issue === "offline" ? "Offline" : state.issue !== null ? "Last known" : state.stale ? "Cached" : null;
  if (label === null) return null;
  return (
    <span className="freshness" role="status">
      <span className="freshness__dot" aria-hidden="true" />
      <Caps>{label}</Caps>
    </span>
  );
}
