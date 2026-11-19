/**
 * Where persisted documents physically live. Documents are named like files: "settings",
 * "layouts/work", "themes/custom-ember". The browser build keeps them in localStorage; the
 * desktop build is meant to back the same interface with files under the app data folder.
 *
 * Contract for implementers:
 * - `write` is atomic: a concurrent or later `read` sees the old text or the new text, never a mix.
 * - `watch` reports changes made by someone else (another window), never the caller's own writes.
 */
export interface StorageBackend {
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** Names starting with `prefix`, without any bookkeeping copies (".bak", ".corrupt", ".v1"…). */
  list(prefix: string): Promise<readonly string[]>;
  watch(handler: (name: string) => void): () => void;
  /**
   * Runs `fn` while holding a lock on `name`, across every window sharing this storage. Read-modify-write
   * on a document must happen inside it, or two windows saving different parts can erase each other.
   */
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/** Serialises async work per key within one JS context. */
class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(fn);
    this.tails.set(key, result);
    return result;
  }
}

/** Bookkeeping suffixes the document layer adds next to a document; `list` hides them. */
const BOOKKEEPING = /\.(bak|corrupt|future|v\d+)$/;

export function isBookkeepingName(name: string): boolean {
  return BOOKKEEPING.test(name);
}

/** In-memory backend for tests and for browsers with storage disabled. */
export class MemoryBackend implements StorageBackend {
  private readonly files = new Map<string, string>();
  private readonly watchers = new Set<(name: string) => void>();

  /** Test hook: change a document the way another window would. */
  externalWrite(name: string, text: string): void {
    this.files.set(name, text);
    this.watchers.forEach((w) => w(name));
  }

  get names(): readonly string[] {
    return [...this.files.keys()];
  }

  read(name: string): Promise<string | null> {
    return Promise.resolve(this.files.get(name) ?? null);
  }
  write(name: string, text: string): Promise<void> {
    this.files.set(name, text);
    return Promise.resolve();
  }
  remove(name: string): Promise<void> {
    this.files.delete(name);
    return Promise.resolve();
  }
  list(prefix: string): Promise<readonly string[]> {
    return Promise.resolve([...this.files.keys()].filter((n) => n.startsWith(prefix) && !isBookkeepingName(n)).sort());
  }
  watch(handler: (name: string) => void): () => void {
    this.watchers.add(handler);
    return () => this.watchers.delete(handler);
  }
  /** Every user of one MemoryBackend shares this queue, standing in for the cross-window lock. */
  private readonly queue = new KeyedQueue();
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.queue.run(name, fn);
  }
}

/** The subset of the Web Storage API this backend needs; lets tests pass a fake. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY_PREFIX = "dotdock/";

/** localStorage backend. `setItem` is atomic per key, and `storage` events carry cross-window changes. */
export class LocalStorageBackend implements StorageBackend {
  constructor(
    private readonly storage: StorageLike,
    private readonly target: Pick<Window, "addEventListener" | "removeEventListener"> | null = null,
  ) {}

  read(name: string): Promise<string | null> {
    return Promise.resolve(this.storage.getItem(KEY_PREFIX + name));
  }
  write(name: string, text: string): Promise<void> {
    try {
      this.storage.setItem(KEY_PREFIX + name, text);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error("Storage write failed"));
    }
  }
  remove(name: string): Promise<void> {
    this.storage.removeItem(KEY_PREFIX + name);
    return Promise.resolve();
  }
  list(prefix: string): Promise<readonly string[]> {
    const names: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key?.startsWith(KEY_PREFIX + prefix)) names.push(key.slice(KEY_PREFIX.length));
    }
    return Promise.resolve(names.filter((n) => !isBookkeepingName(n)).sort());
  }
  watch(handler: (name: string) => void): () => void {
    const target = this.target;
    if (!target) return () => undefined;
    const listener = (e: Event): void => {
      const key = (e as StorageEvent).key;
      if (key?.startsWith(KEY_PREFIX)) handler(key.slice(KEY_PREFIX.length));
    };
    target.addEventListener("storage", listener);
    return () => target.removeEventListener("storage", listener);
  }
  private readonly queue = new KeyedQueue();
  /** Web Locks give a real cross-window mutex; without them (old engines) fall back to in-window ordering. */
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return this.queue.run(name, fn);
    return locks.request(`dotdock:${name}`, fn);
  }
}

/** The backend for this runtime. Falls back to memory when storage is blocked, so the app still runs. */
export function createDefaultBackend(): StorageBackend {
  try {
    const probe = "dotdock/.probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return new LocalStorageBackend(window.localStorage, window);
  } catch {
    return new MemoryBackend();
  }
}
