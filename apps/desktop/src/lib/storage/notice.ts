/** A non-blocking message for the user: shown, never modal, never required to dismiss. */
export type NoticeLevel = "info" | "warning" | "error";

export interface Notice {
  /** Same key replaces the earlier notice instead of stacking. */
  readonly key: string;
  readonly level: NoticeLevel;
  readonly message: string;
}

export type NoticeSink = (notice: Notice) => void;
