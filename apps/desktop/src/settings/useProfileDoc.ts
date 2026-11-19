import { useCallback, useEffect, useState } from "react";
import { layoutName } from "../lib/model/codecs";
import type { LayoutDoc, MonitorId } from "../lib/model/types";
import { PRIMARY_MONITOR } from "../lib/model/types";
import { getNativeApi, type DisplayInfo } from "../lib/native/api";
import { getApp } from "../lib/state/app";

/** The layout document of a profile, kept fresh when the overlay (another window) edits it. */
export function useProfileDoc(profileId: string): { readonly doc: LayoutDoc | null; readonly refresh: () => void } {
  const app = getApp();
  const [doc, setDoc] = useState<LayoutDoc | null>(null);
  const refresh = useCallback(() => {
    void app.repo.load(profileId).then(setDoc);
  }, [app, profileId]);

  useEffect(() => {
    setDoc(null);
    refresh();
    return app.backend.watch((name) => {
      if (name === layoutName(profileId)) refresh();
    });
  }, [app, profileId, refresh]);

  return { doc, refresh };
}

export interface DisplayChoice {
  readonly id: MonitorId;
  readonly label: string;
  readonly isPrimary: boolean;
}

/**
 * The displays a layout can be edited for: the ones the app reports, plus any the profile already
 * remembers (a monitor that is unplugged keeps its layout). A plain browser has the one screen.
 */
export function useDisplayChoices(doc: LayoutDoc | null): readonly DisplayChoice[] {
  const [displays, setDisplays] = useState<readonly DisplayInfo[]>([]);
  useEffect(() => {
    const native = getNativeApi();
    if (!native.available) return;
    native.displays.list().then(setDisplays, () => setDisplays([]));
  }, []);

  const known = new Map<MonitorId, DisplayChoice>();
  if (displays.length === 0) {
    known.set(PRIMARY_MONITOR, { id: PRIMARY_MONITOR, label: "This screen", isPrimary: true });
  }
  for (const d of displays) known.set(d.id, { id: d.id, label: d.name, isPrimary: d.primary });
  if (doc) {
    for (const id of Object.keys(doc.monitors)) {
      if (id === PRIMARY_MONITOR && displays.length > 0) continue;
      if (!known.has(id)) known.set(id, { id, label: id === PRIMARY_MONITOR ? "This screen" : `Display ${id}`, isPrimary: id === PRIMARY_MONITOR });
    }
  }
  return [...known.values()];
}
