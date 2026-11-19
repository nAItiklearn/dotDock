/**
 * Origin: the two types the copied island modules need, from apps/desktop/src/island/protocol.ts.
 * Copied, not imported, because the website is a separate app. Keep in sync by hand.
 */
export type Phase =
  | "idle"
  | "thinking"
  | "reading"
  | "searching"
  | "editing"
  | "running"
  | "waiting"
  | "done"
  | "paused"
  | "limit"
  | "error"
  | "stopped";

export type IconStyle = "dots" | "blocks" | "stripes";
