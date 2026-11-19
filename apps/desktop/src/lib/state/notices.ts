import { createStore, type StoreApi } from "zustand/vanilla";
import type { Notice, NoticeSink } from "../storage/notice";

/** The most notices kept at once; older ones fall off so a failing disk cannot flood the screen. */
const MAX_NOTICES = 4;

export interface NoticeState {
  readonly notices: readonly Notice[];
  push: NoticeSink;
  dismiss: (key: string) => void;
}

export type NoticeStore = StoreApi<NoticeState>;

export function createNoticeStore(): NoticeStore {
  return createStore<NoticeState>()((set) => ({
    notices: [],
    push: (notice) =>
      set((s) => ({ notices: [...s.notices.filter((n) => n.key !== notice.key), notice].slice(-MAX_NOTICES) })),
    dismiss: (key) => set((s) => ({ notices: s.notices.filter((n) => n.key !== key) })),
  }));
}
