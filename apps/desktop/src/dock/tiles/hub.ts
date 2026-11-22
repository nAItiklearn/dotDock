import type { FeedName, TileFeed, TileFeeds, TilesBackend, Unsubscribe } from "./ui-types";

/**
 * Reference-counted subscription to the core's feeds. A feed is read only while a tile that shows it is mounted,
 * and the subscription is renewed when that set changes, so a dock with two tiles asks the core for two feeds.
 */
export class FeedHub {
  private readonly counts = new Map<FeedName, number>();
  private off: Unsubscribe | null = null;
  private subscribed = "";

  constructor(
    private readonly backend: () => TilesBackend,
    private readonly deliver: (changes: Partial<TileFeeds>) => void,
  ) {}

  /** Starts reading `name`. The returned function stops it. */
  acquire(name: FeedName): Unsubscribe {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    this.sync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.counts.get(name) ?? 1) - 1;
      if (left <= 0) this.counts.delete(name);
      else this.counts.set(name, left);
      this.sync();
    };
  }

  /** Feeds being read right now, sorted. */
  active(): readonly FeedName[] {
    return [...this.counts.keys()].sort();
  }

  private sync(): void {
    const wanted = this.active();
    const key = wanted.join(",");
    if (key === this.subscribed) return;
    this.off?.();
    this.off = null;
    this.subscribed = key;
    if (wanted.length > 0) this.off = this.backend().subscribe(wanted, this.deliver);
  }
}

/** The one feed whose data may be null with no issue: a day with no meeting is a state, not a failure. */
const NULLABLE: ReadonlySet<FeedName> = new Set<FeedName>(["meeting"]);

/** A feed with neither data nor a reason breaks the contract; it reads as an error instead of crashing a tile. */
export function normalise(changes: Partial<TileFeeds>): Partial<TileFeeds> {
  const entries = Object.entries(changes).map(([name, feed]) => {
    const broken = feed.data === null && feed.issue === null && !NULLABLE.has(name as FeedName);
    return [name, broken ? { data: null, issue: "error" } : feed] as const;
  });
  return Object.fromEntries(entries) as Partial<TileFeeds>;
}

/** A feed that has delivered data, as the tiles read it: the data, or why there is none. */
export type FeedRead<T> = { readonly state: "pending" } | { readonly state: "issue"; readonly issue: NonNullable<TileFeed<T>["issue"]> } | { readonly state: "ready"; readonly data: T };

export function readFeed<T>(feed: TileFeed<T> | null): FeedRead<T> {
  if (feed === null) return { state: "pending" };
  if (feed.issue !== null) return { state: "issue", issue: feed.issue };
  return { state: "ready", data: feed.data as T };
}
