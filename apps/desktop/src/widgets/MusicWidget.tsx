import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { DotIcon } from "../design-system/DotMatrix";
import { Caps, DotMeter, IconButton, Surface } from "../design-system/primitives";
import { useNow } from "../providers/clock";
import { useProvider } from "../providers/store";
import type { MediaData, ProviderState } from "../providers/types";
import { accentFromArtwork, type ArtworkAccent } from "./artworkAccent";
import type { ConfigSchema } from "./configSchema";
import { defineWidget, type WidgetProps } from "./definition";
import { formatDuration } from "./format";
import { sendMediaCommand } from "./mediaControls";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import { Freshness, WidgetNotice } from "./WidgetNotice";
import "./MusicWidget.css";

export interface MusicConfig {
  /** Tint the play button and progress with the colour of the cover art. */
  readonly accentFromArtwork: boolean;
}

export const MUSIC_SIZES: readonly SizeSpec[] = [
  { id: "s", name: "Pill", w: 3, h: 1 },
  { id: "m", name: "Card", w: 4, h: 2 },
  { id: "l", name: "Player", w: 4, h: 4 },
];

const MUSIC_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    accentFromArtwork: {
      type: "boolean",
      title: "Accent follows cover art",
      description: "Colours the play button and progress from the current artwork.",
      default: false,
    },
  },
};

const PROGRESS_DOTS = { card: 34, player: 40 } as const;
const PROGRESS_DOT = { dot: 5, gap: 4 } as const;
const SEEK_STEP_SECONDS = 5;
const MS_PER_SECOND = 1000;

/** What the widget shows: a live session, or the designed "nothing playing" state. */
function useSession(): { media: MediaData | null; state: ProviderState<MediaData> } {
  const state = useProvider("media");
  // Remembered media from a previous run is never shown as if it were playing now.
  return { media: state.stale ? null : state.data, state };
}

/** Position now, extrapolated from the last payload while playing. */
function useLivePosition(media: MediaData, receivedAt: number): number {
  const now = useNow();
  const elapsed = media.playing ? (now.getTime() - receivedAt) / MS_PER_SECOND : 0;
  const position = media.positionSec + Math.max(0, elapsed);
  return media.durationSec > 0 ? Math.min(media.durationSec, position) : position;
}

function useArtworkAccent(artwork: string | null, enabled: boolean): ArtworkAccent | null {
  const [accent, setAccent] = useState<{ source: string; value: ArtworkAccent | null } | null>(null);
  useEffect(() => {
    if (!enabled || artwork === null) return;
    let cancelled = false;
    void accentFromArtwork(artwork).then((value) => {
      if (!cancelled) setAccent({ source: artwork, value });
    });
    return () => {
      cancelled = true;
    };
  }, [artwork, enabled]);
  return enabled && artwork !== null && accent?.source === artwork ? accent.value : null;
}

function accentStyle(accent: ArtworkAccent | null): CSSProperties | undefined {
  return accent ? ({ "--accent": accent.color, "--accent-ink": accent.ink } as CSSProperties) : undefined;
}

function Artwork({ media, className }: { readonly media: MediaData; readonly className: string }) {
  return media.artwork ? (
    <img className={`music__art ${className}`} src={media.artwork} alt="" decoding="async" draggable={false} />
  ) : (
    <div className={`music__art music__art--empty ${className}`} aria-hidden="true">
      <DotIcon name="note" />
    </div>
  );
}

function Scrubber({ media, position, count }: { readonly media: MediaData; readonly position: number; readonly count: number }) {
  const fraction = media.durationSec > 0 ? position / media.durationSec : 0;
  const seekable = media.canSeek && media.durationSec > 0;
  const seek = (seconds: number): void => {
    if (seekable) sendMediaCommand({ action: "seek", positionSec: Math.min(media.durationSec, Math.max(0, seconds)) });
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    const box = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - box.left) / box.width) * media.durationSec);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "ArrowRight") seek(position + SEEK_STEP_SECONDS);
    else if (e.key === "ArrowLeft") seek(position - SEEK_STEP_SECONDS);
    else return;
    e.preventDefault();
  };
  return (
    <div className="music__progress">
      <div
        className={`music__scrub${seekable ? " music__scrub--seekable" : ""}`}
        role="slider"
        aria-label="Track position"
        aria-valuemin={0}
        aria-valuemax={Math.round(media.durationSec)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${formatDuration(position * MS_PER_SECOND)} of ${formatDuration(media.durationSec * MS_PER_SECOND)}`}
        aria-disabled={!seekable}
        tabIndex={seekable ? 0 : -1}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <DotMeter value={fraction} count={count} dot={PROGRESS_DOT.dot} gap={PROGRESS_DOT.gap} />
      </div>
      <div className="music__times tabular">
        <span>{formatDuration(position * MS_PER_SECOND)}</span>
        <span>{media.durationSec > 0 ? formatDuration(media.durationSec * MS_PER_SECOND) : "Live"}</span>
      </div>
    </div>
  );
}

function Transport({ media, play }: { readonly media: MediaData; readonly play: "md" | "lg" }) {
  return (
    <div className="music__transport">
      <IconButton
        icon="previous"
        label="Previous track"
        tone="ghost"
        size="md"
        disabled={!media.canPrev}
        onClick={() => sendMediaCommand({ action: "previous" })}
      />
      <IconButton
        icon={media.playing ? "pause" : "play"}
        label={media.playing ? "Pause" : "Play"}
        tone="accent"
        size={play}
        onClick={() => sendMediaCommand({ action: "toggle" })}
      />
      <IconButton
        icon="next"
        label="Next track"
        tone="ghost"
        size="md"
        disabled={!media.canNext}
        onClick={() => sendMediaCommand({ action: "next" })}
      />
    </div>
  );
}

function Idle({ size }: { readonly size: SizeId }) {
  return (
    <div className={`music-idle music-idle--${size}`}>
      <DotIcon name="note" className="music-idle__icon" />
      <div className="music-idle__copy">
        <Caps>Music</Caps>
        <span className="music-idle__text">Nothing playing</span>
        {size === "s" ? null : <span className="music-idle__hint">Start a track in any player</span>}
      </div>
    </div>
  );
}

function Pill({ media, accent }: { readonly media: MediaData; readonly accent: ArtworkAccent | null }) {
  const spec = sizeSpec(MUSIC_SIZES, "s");
  return (
    <Surface shape="pill" w={spec.w} h={spec.h} label={`${media.title} by ${media.artist}`} style={accentStyle(accent)}>
      <div className="music-pill">
        <IconButton
          icon={media.playing ? "pause" : "play"}
          label={media.playing ? "Pause" : "Play"}
          tone="accent"
          size="md"
          onClick={() => sendMediaCommand({ action: "toggle" })}
        />
        <div className="music__titles">
          <span className="music__title">{media.title}</span>
          <Caps>{media.artist}</Caps>
        </div>
      </div>
    </Surface>
  );
}

function Card({ media, receivedAt, accent }: { readonly media: MediaData; readonly receivedAt: number; readonly accent: ArtworkAccent | null }) {
  const spec = sizeSpec(MUSIC_SIZES, "m");
  const position = useLivePosition(media, receivedAt);
  return (
    <Surface shape="card" w={spec.w} h={spec.h} label={`${media.title} by ${media.artist}`} style={accentStyle(accent)}>
      <div className="music-card">
        <Artwork media={media} className="music-card__art" />
        <div className="music-card__body">
          <div className="music__titles">
            <span className="music__title music__title--lg">{media.title}</span>
            <Caps>{media.artist}</Caps>
          </div>
          <Scrubber media={media} position={position} count={PROGRESS_DOTS.card} />
          <Transport media={media} play="md" />
        </div>
      </div>
    </Surface>
  );
}

function Player({ media, receivedAt, accent }: { readonly media: MediaData; readonly receivedAt: number; readonly accent: ArtworkAccent | null }) {
  const spec = sizeSpec(MUSIC_SIZES, "l");
  const position = useLivePosition(media, receivedAt);
  return (
    <Surface shape="card" w={spec.w} h={spec.h} label={`${media.title} by ${media.artist}`} style={accentStyle(accent)}>
      <div className="music-player">
        <Artwork media={media} className="music-player__art" />
        <div className="music__titles music__titles--center">
          <span className="music__title music__title--lg">{media.title}</span>
          <Caps>{media.album ? `${media.artist} · ${media.album}` : media.artist}</Caps>
        </div>
        <Scrubber media={media} position={position} count={PROGRESS_DOTS.player} />
        <Transport media={media} play="lg" />
      </div>
    </Surface>
  );
}

function LivePlayer({ media, size, accentFollows }: { readonly media: MediaData; readonly size: SizeId; readonly accentFollows: boolean }) {
  // The payload is the position at the moment it arrived; remember when that was to keep counting.
  const receivedAt = useMemo(() => Date.now(), [media]);
  const accent = useArtworkAccent(media.artwork, accentFollows);
  if (size === "s") return <Pill media={media} accent={accent} />;
  if (size === "l") return <Player media={media} receivedAt={receivedAt} accent={accent} />;
  return <Card media={media} receivedAt={receivedAt} accent={accent} />;
}

const SHAPE: Record<SizeId, "pill" | "card"> = { s: "pill", m: "card", l: "card", xl: "card" };

export function MusicWidget({ size = "m", config = { accentFromArtwork: false } }: { readonly size?: SizeId; readonly config?: MusicConfig }) {
  const { media, state } = useSession();
  if (media) return <LivePlayer media={media} size={size} accentFollows={config.accentFromArtwork} />;
  const spec = sizeSpec(MUSIC_SIZES, size);
  const unavailable = state.issue === "unsupported" || state.issue === "error";
  return (
    <Surface shape={SHAPE[size]} w={spec.w} h={spec.h} label="Music">
      {unavailable ? <WidgetNotice title="Music" issue={state.issue} compact={size === "s"} /> : <Idle size={size} />}
      <Freshness state={state} />
    </Surface>
  );
}

export const musicWidget = defineWidget<MusicConfig>({
  id: "music",
  name: "Music",
  description: "Now playing from any player: artwork, progress and transport controls.",
  category: "media",
  sizes: MUSIC_SIZES,
  providers: ["media"],
  defaultConfig: { accentFromArtwork: false },
  settingsSchema: MUSIC_SCHEMA,
  component: ({ config, size }: WidgetProps<MusicConfig>) => <MusicWidget size={size} config={config} />,
});
