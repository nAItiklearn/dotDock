import { useStore } from "zustand";
import { getApp } from "./app";
import type { LayoutState } from "./layoutStore";
import type { NoticeState } from "./notices";
import type { SettingsState } from "./settingsStore";

/** Selector hooks bound to this page's app. Select primitives or stable references, never fresh objects. */
export const useSettingsStore = <T>(selector: (state: SettingsState) => T): T => useStore(getApp().settings, selector);
export const useLayoutStore = <T>(selector: (state: LayoutState) => T): T => useStore(getApp().layout, selector);
export const useNoticeStore = <T>(selector: (state: NoticeState) => T): T => useStore(getApp().notices, selector);
