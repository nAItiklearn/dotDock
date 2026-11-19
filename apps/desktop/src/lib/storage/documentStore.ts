import { migrateDocument, type Migration } from "../model/migrate";
import type { Sanitized } from "../model/sanitize";
import type { StorageBackend } from "./backend";
import type { NoticeSink } from "./notice";

export interface DocumentCodec<T> {
  readonly schema: number;
  readonly migrations: Readonly<Record<number, Migration>>;
  defaults(): T;
  /** Turns a migrated document into a valid model, repairing field by field. */
  decode(doc: Record<string, unknown>): Sanitized<T>;
}

export type LoadSource = "primary" | "backup" | "defaults" | "missing";

export interface LoadResult<T> {
  readonly value: T;
  readonly source: LoadSource;
}

type Decoded<T> = { readonly ok: true; readonly value: T; readonly repairs: readonly string[]; readonly from: number } | { readonly ok: false; readonly reason: string };

/**
 * One persisted document with atomic-write, last-good-copy and corruption-fallback semantics.
 *
 * Save order is: previous good text → `<name>.bak`, then new text → `<name>`. Each write is atomic
 * in the backend, so a crash between them leaves two good copies; at no point is there none.
 * Loading never throws: a damaged document falls back to the backup, then to defaults, and the
 * user gets a notice instead of a crash. Damaged text is kept as `<name>.corrupt` for diagnosis.
 */
export class DocumentStore<T> {
  private lastGoodText: string | null = null;
  private pending: { value: T; waiters: { resolve: () => void; reject: (e: unknown) => void }[] } | null = null;
  private draining = false;
  private lastFailureAt = 0;

  constructor(
    private readonly backend: StorageBackend,
    readonly name: string,
    private readonly codec: DocumentCodec<T>,
    /** Human wording for notices, e.g. "your settings" or "the Work layout". */
    private readonly label: string,
    private readonly notify: NoticeSink,
  ) {}

  private decode(text: string): Decoded<T> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "invalid" };
    }
    const migrated = migrateDocument(parsed, this.codec.schema, this.codec.migrations);
    if (!migrated.ok) return { ok: false, reason: migrated.reason === "future" ? "future" : "invalid" };
    try {
      const decoded = this.codec.decode(migrated.doc);
      return { ok: true, value: decoded.value, repairs: decoded.repairs, from: migrated.from };
    } catch {
      // A codec may reject a document it cannot repair; that is damage like any other.
      return { ok: false, reason: "invalid" };
    }
  }

  async load(): Promise<LoadResult<T>> {
    let primary: string | null = null;
    try {
      primary = await this.backend.read(this.name);
    } catch {
      this.notify({ key: `read:${this.name}`, level: "error", message: `Couldn't read ${this.label}. Using defaults for now.` });
      return { value: this.codec.defaults(), source: "defaults" };
    }
    if (primary === null) {
      const backup = await this.safeRead(`${this.name}.bak`);
      if (backup === null) return { value: this.codec.defaults(), source: "missing" };
      // The primary vanished but a backup survived: treat it like a damaged primary.
      return this.recover(null);
    }

    const result = this.decode(primary);
    if (result.ok) {
      this.lastGoodText = primary;
      if (result.from < this.codec.schema) {
        // Keep the pre-migration text so an upgrade can always be undone by hand.
        await this.backend.write(`${this.name}.v${result.from}`, primary).catch(() => undefined);
      }
      if (result.repairs.length > 0) {
        this.notify({
          key: `repair:${this.name}`,
          level: "info",
          message: `Some values in ${this.label} were out of range and were corrected.`,
        });
      }
      return { value: result.value, source: "primary" };
    }
    return this.recover({ text: primary, reason: result.reason });
  }

  private async safeRead(name: string): Promise<string | null> {
    try {
      return await this.backend.read(name);
    } catch {
      return null;
    }
  }

  private async recover(damaged: { text: string; reason: string } | null): Promise<LoadResult<T>> {
    if (damaged) {
      const suffix = damaged.reason === "future" ? "future" : "corrupt";
      await this.backend.write(`${this.name}.${suffix}`, damaged.text).catch(() => undefined);
    }
    const backupText = await this.safeRead(`${this.name}.bak`);
    const backup = backupText === null ? null : this.decode(backupText);
    if (backupText !== null && backup?.ok) {
      this.lastGoodText = backupText;
      await this.backend.write(this.name, backupText).catch(() => undefined);
      this.notify({
        key: `recover:${this.name}`,
        level: "warning",
        message: `Couldn't read ${this.label}. Restored the last good copy.`,
      });
      return { value: backup.value, source: "backup" };
    }
    this.lastGoodText = null;
    this.notify({
      key: `recover:${this.name}`,
      level: "warning",
      message:
        damaged?.reason === "future"
          ? `${capitalise(this.label)} came from a newer version, so defaults are in use. The original is kept.`
          : `Couldn't read ${this.label}. Started from defaults; the damaged copy is kept.`,
    });
    return { value: this.codec.defaults(), source: "defaults" };
  }

  /** Queues a write. Rapid saves coalesce: only the latest value reaches storage. Resolves once it is stored. */
  save(value: T): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiters = this.pending?.waiters ?? [];
      waiters.push({ resolve, reject });
      this.pending = { value, waiters };
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.pending) {
      const job = this.pending;
      this.pending = null;
      try {
        await this.writeNow(job.value);
        job.waiters.forEach((w) => w.resolve());
      } catch (error) {
        this.reportWriteFailure();
        job.waiters.forEach((w) => w.reject(error));
      }
    }
    this.draining = false;
  }

  private async writeNow(value: T): Promise<void> {
    const text = JSON.stringify(value);
    if (text === this.lastGoodText) return;
    if (this.lastGoodText !== null) await this.backend.write(`${this.name}.bak`, this.lastGoodText);
    await this.backend.write(this.name, text);
    this.lastGoodText = text;
  }

  private reportWriteFailure(): void {
    const now = Date.now();
    if (now - this.lastFailureAt < 10_000) return;
    this.lastFailureAt = now;
    this.notify({
      key: `write:${this.name}`,
      level: "error",
      message: `Couldn't save ${this.label}. Your changes will be lost when the app closes.`,
    });
  }

  async remove(): Promise<void> {
    this.lastGoodText = null;
    await Promise.all([this.backend.remove(this.name), this.backend.remove(`${this.name}.bak`)]);
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
