import { useEffect } from "react";
import { IconButton } from "../lib/ui/controls";
import { Icon } from "../lib/ui/Icon";
import { getApp } from "../lib/state/app";
import { useNoticeStore } from "../lib/state/hooks";
import type { Notice } from "../lib/storage/notice";

/** How long a passing remark stays; problems stay until dismissed. */
const INFO_LIFETIME_MS = 7000;

function ToastItem({ notice }: { readonly notice: Notice }) {
  useEffect(() => {
    if (notice.level !== "info") return undefined;
    const timer = setTimeout(() => getApp().notices.getState().dismiss(notice.key), INFO_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <li className={`toast toast--${notice.level}`}>
      <Icon name={notice.level === "info" ? "info" : "warning"} size={16} />
      <span className="toast__text">{notice.message}</span>
      <IconButton icon="close" label="Dismiss" onClick={() => getApp().notices.getState().dismiss(notice.key)} />
    </li>
  );
}

/** Non-blocking messages from the storage layer and layout edits. Never modal, never in the way of widgets. */
export function NoticeToasts() {
  const notices = useNoticeStore((s) => s.notices);
  return (
    <ul className="toasts" data-hit aria-label="Notices">
      {notices.map((n) => (
        <ToastItem key={n.key} notice={n} />
      ))}
    </ul>
  );
}
