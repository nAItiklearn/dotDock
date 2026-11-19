import { createStore, type StoreApi } from "zustand/vanilla";
import { layoutName } from "../model/codecs";
import type { JsonObject } from "../model/json";
import type { AppSettings, Bounds, Cell, MonitorId, Placement, WidgetCatalogMeta } from "../model/types";
import type { StorageBackend } from "../storage/backend";
import type { NoticeSink } from "../storage/notice";
import { canRedo, canUndo, createHistory, pushHistory, redoHistory, undoHistory, type History } from "../layout/history";
import {
  addWidget,
  duplicateWidget,
  moveTo,
  neighbourSize,
  normalizePlacements,
  patchConfig,
  removeWidget,
  resizeTo,
  type LayoutContext,
} from "../layout/ops";
import { monitorLayoutOf, type LayoutRepository } from "./layoutRepo";

/** Edits are written shortly after the last one, so a crash while editing loses at most a moment. */
const SAVE_DELAY_MS = 400;
/** Config changes to the same field closer together than this belong to one gesture. */
const PATCH_COALESCE_MS = 800;

export type EditResult =
  | { readonly ok: true; readonly id?: string }
  | { readonly ok: false; readonly reason: "locked" | "no-room" | "unknown" };

export interface LayoutState {
  readonly ready: boolean;
  readonly profileId: string;
  readonly bounds: Bounds;
  readonly editing: boolean;
  readonly selectedId: string | null;
  /** What the overlay draws: the working copy while editing, otherwise the stored layout fitted to this display. */
  readonly placements: readonly Placement[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;

  init(profileId: string): Promise<void>;
  loadProfile(profileId: string): Promise<void>;
  setBounds(bounds: Bounds): void;
  context(): LayoutContext;

  enterEdit(selectId?: string): void;
  exitEdit(): Promise<void>;
  select(id: string | null): void;

  /** Applies a finished drag: placements already resolved against collisions. */
  commit(next: readonly Placement[]): void;
  moveTo(id: string, cell: Cell): EditResult;
  nudge(id: string, dx: number, dy: number): EditResult;
  resizeTo(id: string, sizeId: string): EditResult;
  stepSize(id: string, direction: 1 | -1): EditResult;
  addWidget(kind: string, sizeId?: string): EditResult;
  duplicate(id: string): EditResult;
  remove(id: string): EditResult;
  patchConfig(id: string, patch: JsonObject): EditResult;
  undo(): void;
  redo(): void;
}

export type LayoutStore = StoreApi<LayoutState>;

export interface LayoutDeps {
  readonly backend: StorageBackend;
  readonly repo: LayoutRepository;
  readonly catalog: WidgetCatalogMeta;
  readonly getSettings: () => AppSettings;
  readonly notify: NoticeSink;
  readonly monitorId: MonitorId;
  /** True when this overlay covers the primary display, which may still use the generic "primary" layout. */
  readonly isPrimary: boolean;
  /** Initial grid extent; replaced as soon as the view measures itself. */
  readonly initialBounds: Bounds;
}

const NO_ROOM_NOTICE = {
  key: "layout:no-room",
  level: "info",
  message: "There's no room for that. Remove a widget or choose a smaller size.",
} as const;

export function createLayoutStore(deps: LayoutDeps): LayoutStore {
  const { backend, repo, catalog, getSettings, notify, monitorId, isPrimary } = deps;

  return createStore<LayoutState>()((set, get) => {
    let stored: readonly Placement[] = [];
    let history: History<readonly Placement[]> | null = null;
    let dirty = false;
    let lastPatch: { id: string; keys: string; at: number } | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let unwatch: (() => void) | null = null;

    const context = (): LayoutContext => ({
      bounds: get().bounds,
      collision: getSettings().layout.collision,
      catalog,
    });

    const present = (): readonly Placement[] => history?.present ?? get().placements;
    const isLocked = (): boolean => getSettings().layout.locked;

    const publish = (placements: readonly Placement[]): void => {
      set({
        placements,
        canUndo: history ? canUndo(history) : false,
        canRedo: history ? canRedo(history) : false,
      });
    };

    const save = async (): Promise<void> => {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (!dirty || !history) return;
      const placements = history.present;
      dirty = false;
      stored = placements;
      await repo.setPlacements(get().profileId, monitorId, placements).catch(() => undefined);
    };

    const scheduleSave = (): void => {
      dirty = true;
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS);
    };

    /** Records one undoable step. */
    const commitStep = (next: readonly Placement[]): void => {
      lastPatch = null;
      if (!history) return;
      const before = history;
      history = pushHistory(history, next);
      if (history === before) return;
      publish(next);
      scheduleSave();
    };

    const guarded = (change: () => EditResult): EditResult => {
      if (!get().editing) return { ok: false, reason: "unknown" };
      if (isLocked()) return { ok: false, reason: "locked" };
      return change();
    };

    const watchProfile = (profileId: string): void => {
      unwatch?.();
      unwatch = backend.watch((name) => {
        if (name !== layoutName(profileId) || get().editing) return;
        void repo.load(profileId).then((doc) => {
          stored = monitorLayoutOf(doc, monitorId, isPrimary).placements;
          publish(normalizePlacements(stored, context()));
        });
      });
    };

    return {
      ready: false,
      profileId: "",
      bounds: deps.initialBounds,
      editing: false,
      selectedId: null,
      placements: [],
      canUndo: false,
      canRedo: false,

      context,

      async init(profileId) {
        await get().loadProfile(profileId);
        set({ ready: true });
      },

      async loadProfile(profileId) {
        if (get().editing) await get().exitEdit();
        const doc = await repo.load(profileId);
        stored = monitorLayoutOf(doc, monitorId, isPrimary).placements;
        history = null;
        set({ profileId, selectedId: null });
        publish(normalizePlacements(stored, context()));
        watchProfile(profileId);
      },

      setBounds(bounds) {
        const current = get().bounds;
        if (current.cols === bounds.cols && current.rows === bounds.rows) return;
        set({ bounds });
        publish(normalizePlacements(history?.present ?? stored, context()));
      },

      enterEdit(selectId) {
        if (!get().editing) {
          history = createHistory(get().placements);
          dirty = false;
          set({ editing: true, canUndo: false, canRedo: false });
        }
        if (selectId !== undefined) set({ selectedId: selectId });
      },

      async exitEdit() {
        if (!get().editing) return;
        await save();
        history = null;
        set({ editing: false, selectedId: null });
        publish(normalizePlacements(stored, context()));
      },

      select: (id) => set({ selectedId: id }),

      commit: (next) => {
        if (!get().editing || isLocked()) return;
        commitStep(next);
      },

      moveTo: (id, cell) =>
        guarded(() => {
          const next = moveTo(present(), id, cell, context());
          if (!next) return { ok: false, reason: "no-room" };
          commitStep(next);
          return { ok: true };
        }),

      nudge(id, dx, dy) {
        const p = present().find((x) => x.id === id);
        if (!p) return { ok: false, reason: "unknown" };
        return get().moveTo(id, { x: p.x + dx, y: p.y + dy });
      },

      resizeTo: (id, sizeId) =>
        guarded(() => {
          const next = resizeTo(present(), id, sizeId, context());
          if (!next) {
            notify(NO_ROOM_NOTICE);
            return { ok: false, reason: "no-room" };
          }
          commitStep(next);
          return { ok: true };
        }),

      stepSize(id, direction) {
        const sizeId = neighbourSize(present(), id, direction, context());
        return sizeId ? get().resizeTo(id, sizeId) : { ok: false, reason: "unknown" };
      },

      addWidget: (kind, sizeId) =>
        guarded(() => {
          const added = addWidget(present(), kind, sizeId, context());
          if (!added) {
            notify(NO_ROOM_NOTICE);
            return { ok: false, reason: "no-room" };
          }
          commitStep(added.placements);
          set({ selectedId: added.id });
          return { ok: true, id: added.id };
        }),

      duplicate: (id) =>
        guarded(() => {
          const added = duplicateWidget(present(), id, context());
          if (!added) {
            notify(NO_ROOM_NOTICE);
            return { ok: false, reason: "no-room" };
          }
          commitStep(added.placements);
          set({ selectedId: added.id });
          return { ok: true, id: added.id };
        }),

      remove: (id) =>
        guarded(() => {
          const next = removeWidget(present(), id);
          if (next === present()) return { ok: false, reason: "unknown" };
          commitStep(next);
          if (get().selectedId === id) set({ selectedId: null });
          return { ok: true };
        }),

      patchConfig: (id, patch) =>
        guarded(() => {
          const next = patchConfig(present(), id, patch);
          const keys = Object.keys(patch).sort().join(",");
          const now = Date.now();
          const continuing = lastPatch && lastPatch.id === id && lastPatch.keys === keys && now - lastPatch.at < PATCH_COALESCE_MS;
          if (continuing && history) {
            // A slider drag is one gesture: it replaces its own previous step instead of burying the undo stack.
            history = { ...history, present: next };
            publish(next);
            scheduleSave();
          } else {
            commitStep(next);
          }
          lastPatch = { id, keys, at: now };
          return { ok: true };
        }),

      undo() {
        if (!history || !get().editing || isLocked() || !canUndo(history)) return;
        history = undoHistory(history);
        const selected = get().selectedId;
        if (selected && !history.present.some((p) => p.id === selected)) set({ selectedId: null });
        lastPatch = null;
        publish(history.present);
        scheduleSave();
      },

      redo() {
        if (!history || !get().editing || isLocked() || !canRedo(history)) return;
        history = redoHistory(history);
        lastPatch = null;
        publish(history.present);
        scheduleSave();
      },
    };
  });
}
