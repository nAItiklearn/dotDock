import { layoutCodec, layoutName } from "../model/codecs";
import { defaultLayoutDoc } from "../model/defaults";
import type { LayoutDoc, MonitorId, MonitorLayout, Placement } from "../model/types";
import { PRIMARY_MONITOR } from "../model/types";
import type { StorageBackend } from "../storage/backend";
import { DocumentStore } from "../storage/documentStore";
import type { NoticeSink } from "../storage/notice";

/** Placements a display shows: its own entry, or for the primary display the generic "primary" one. */
export function monitorLayoutOf(doc: LayoutDoc, monitorId: MonitorId, isPrimary: boolean): MonitorLayout {
  return doc.monitors[monitorId] ?? (isPrimary ? doc.monitors[PRIMARY_MONITOR] : undefined) ?? { placements: [] };
}

/**
 * All layout documents, one per profile. Every change is read-modify-write against what is on
 * disk at that moment, so two overlays saving different displays cannot erase each other's work.
 */
export class LayoutRepository {
  private readonly stores = new Map<string, DocumentStore<LayoutDoc>>();

  constructor(
    private readonly backend: StorageBackend,
    private readonly notify: NoticeSink,
    private readonly profileLabel: (profileId: string) => string,
  ) {}

  private storeFor(profileId: string): DocumentStore<LayoutDoc> {
    let store = this.stores.get(profileId);
    if (!store) {
      store = new DocumentStore(this.backend, layoutName(profileId), layoutCodec(profileId), `the ${this.profileLabel(profileId)} layout`, this.notify);
      this.stores.set(profileId, store);
    }
    return store;
  }

  async load(profileId: string): Promise<LayoutDoc> {
    return (await this.storeFor(profileId).load()).value;
  }

  /** Runs `change` on the freshest copy of the document and saves the result. Calls are serialised per profile. */
  update(profileId: string, change: (doc: LayoutDoc) => LayoutDoc): Promise<LayoutDoc> {
    return this.backend.withLock(layoutName(profileId), async () => {
      const store = this.storeFor(profileId);
      const next = change((await store.load()).value);
      await store.save(next);
      return next;
    });
  }

  /** Convenience for the common case: replace one display's placements. */
  setPlacements(profileId: string, monitorId: MonitorId, placements: readonly Placement[]): Promise<LayoutDoc> {
    return this.update(profileId, (doc) => ({ ...doc, monitors: { ...doc.monitors, [monitorId]: { placements } } }));
  }

  replace(profileId: string, doc: LayoutDoc): Promise<LayoutDoc> {
    return this.update(profileId, () => ({ ...doc, profileId }));
  }

  /** Built-in profiles go back to their shipped arrangement; others become empty. */
  reset(profileId: string): Promise<LayoutDoc> {
    return this.replace(profileId, defaultLayoutDoc(profileId));
  }

  async remove(profileId: string): Promise<void> {
    await this.storeFor(profileId).remove();
    this.stores.delete(profileId);
  }
}
