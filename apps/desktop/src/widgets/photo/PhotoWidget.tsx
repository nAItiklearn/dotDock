import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";
import { DotIcon } from "../../design-system/DotMatrix";
import { Caps, IconButton, Surface } from "../../design-system/primitives";
import { isTauri } from "../../providers/bridge";
import type { ConfigSchema } from "../configSchema";
import { defineWidget, type WidgetProps } from "../definition";
import { sizeSpec, type SizeId, type SizeSpec } from "../sizes";
import { ACCEPTED_TYPES, loadPhoto, readPhotoFile, savePhoto, type PhotoProblem, type StoredPhoto } from "./blobs";
import {
  CENTRED,
  KEY_PAN_STEP,
  KEY_ZOOM_STEP,
  pan,
  place,
  wheelFactor,
  zoomAt,
  type Box,
  type Framing,
  type PhotoFit,
} from "./frame";
import { EMPTY_ENTRY, usePhotoStore } from "./store";
import "./PhotoWidget.css";

export type PhotoMat = "none" | "mat";
export type PhotoTone = "colour" | "mono" | "duotone";

export interface PhotoConfig {
  readonly fit: PhotoFit;
  readonly mat: PhotoMat;
  readonly tone: PhotoTone;
}

/** Large is listed first so a new photo starts big; pickers sort by area. */
export const PHOTO_SIZES: readonly SizeSpec[] = [
  { id: "l", name: "Large", w: 4, h: 4 },
  { id: "s", name: "Square", w: 2, h: 2 },
  { id: "m", name: "Wide", w: 4, h: 2 },
  { id: "xl", name: "Portrait", w: 3, h: 4 },
];

export const PHOTO_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fit: {
      type: "string",
      title: "Fit",
      default: "fill",
      oneOf: [
        { const: "fill", title: "Fill the frame" },
        { const: "fit", title: "Show the whole photo" },
      ],
    },
    mat: {
      type: "string",
      title: "Border",
      default: "none",
      oneOf: [
        { const: "none", title: "Edge to edge" },
        { const: "mat", title: "Mat" },
      ],
    },
    tone: {
      type: "string",
      title: "Colour",
      default: "colour",
      oneOf: [
        { const: "colour", title: "Original" },
        { const: "mono", title: "Black and white" },
        { const: "duotone", title: "Accent duotone" },
      ],
    },
  },
};

const DEFAULT_CONFIG: PhotoConfig = { fit: "fill", mat: "none", tone: "colour" };
/** Framing changes are saved this long after the last wheel step, not on every notch. */
const SAVE_DELAY_MS = 300;

const PROBLEM_TEXT: Readonly<Record<PhotoProblem, string>> = {
  type: "Use a JPEG, PNG, WebP, AVIF, GIF or BMP",
  size: "That file is over 80 MB",
  decode: "That file could not be opened",
};

/**
 * The overlay never takes focus on its own, so a file dialog opened from it could appear behind
 * other windows. It asks the core for the foreground while the dialog is open.
 */
function holdForeground(on: boolean): void {
  if (!isTauri()) return;
  invoke("overlay_set_typing", { typing: on }).catch((err: unknown) => console.error("overlay_set_typing failed", err));
}

interface Loaded {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/** The stored photo for an instance as an object URL, reloaded whenever its revision changes. */
function usePhoto(id: string | undefined, rev: number): { readonly photo: Loaded | null; readonly ready: boolean } {
  const [state, setState] = useState<{ photo: Loaded | null; ready: boolean }>({ photo: null, ready: id === undefined });
  useEffect(() => {
    if (id === undefined) return undefined;
    let url: string | null = null;
    let live = true;
    loadPhoto(id)
      .then(async (stored) => {
        if (!live) return;
        if (!stored) {
          setState({ photo: null, ready: true });
          return;
        }
        url = URL.createObjectURL(stored.blob);
        // Decode before swapping so the new photo never flashes in half drawn.
        const probe = new Image();
        probe.src = url;
        await probe.decode().catch(() => undefined);
        if (live) setState({ photo: { url, width: stored.width, height: stored.height }, ready: true });
      })
      .catch((err: unknown) => {
        console.error("photo load failed", err);
        if (live) setState({ photo: null, ready: true });
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, rev]);
  return state;
}

function useBox<T extends HTMLElement>(): [RefObject<T | null>, Box] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

export interface PhotoWidgetProps {
  readonly size?: SizeId;
  readonly config?: PhotoConfig;
  /** The widget's placement id. Without it (previews, the gallery) the widget shows its empty state. */
  readonly instanceId?: string | undefined;
}

export function PhotoWidget({ size = "l", config = DEFAULT_CONFIG, instanceId }: PhotoWidgetProps) {
  const spec = sizeSpec(PHOTO_SIZES, size);
  const entry = usePhotoStore((s) => (instanceId ? s.entries[instanceId] : undefined)) ?? EMPTY_ENTRY;
  const { photo, ready } = usePhoto(instanceId, entry.rev);
  const [frameRef, frame] = useBox<HTMLDivElement>();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<PhotoProblem | null>(null);
  const [dropping, setDropping] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  // Framing while the user drags or scrolls; saved to the store when the gesture settles.
  const [draft, setDraft] = useState<Framing | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; start: Framing } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const framing = draft ?? entry.framing;
  const fillable = config.fit === "fill" && photo !== null;

  const commit = useCallback(
    (next: Framing) => {
      if (instanceId) usePhotoStore.getState().frame(instanceId, next);
      setDraft(null);
    },
    [instanceId],
  );
  const commitSoon = (next: Framing): void => {
    setDraft(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => commit(next), SAVE_DELAY_MS);
  };
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);
  // Closing the file dialog without a choice fires "cancel", which React does not expose for inputs.
  useEffect(() => {
    const el = input.current;
    if (!el) return undefined;
    const release = (): void => holdForeground(false);
    el.addEventListener("cancel", release);
    return () => el.removeEventListener("cancel", release);
  }, []);

  const accept = async (file: File | undefined): Promise<void> => {
    if (!file || !instanceId) return;
    const read = await readPhotoFile(file);
    if (typeof read === "string") {
      setProblem(read);
      return;
    }
    setProblem(null);
    await savePhoto(instanceId, read satisfies StoredPhoto);
    usePhotoStore.getState().replaced(instanceId);
  };

  const choose = (): void => {
    if (!instanceId) return;
    holdForeground(true);
    input.current?.click();
  };
  const onPicked = (e: ChangeEvent<HTMLInputElement>): void => {
    holdForeground(false);
    const file = e.target.files?.[0];
    e.target.value = "";
    void accept(file);
  };

  const onDragOver = (e: DragEvent): void => {
    if (!instanceId || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const onDrop = (e: DragEvent): void => {
    if (!instanceId) return;
    e.preventDefault();
    setDropping(false);
    void accept(e.dataTransfer.files[0]);
  };

  const photoBox: Box = photo ? { w: photo.width, h: photo.height } : { w: 0, h: 0 };
  const placed = photo ? place(frame, photoBox, config.fit, framing) : null;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (!adjusting || !fillable || e.button !== 0) return;
    // Capture keeps the drag going outside the frame; without it (a pointer the browser no longer
    // tracks) the drag still works while the cursor stays inside, so a failure is not fatal.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* drag continues uncaptured */
    }
    drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, start: framing };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    setDraft(pan(frame, photoBox, d.start, e.clientX - d.x, e.clientY - d.y));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    commit(framing);
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>): void => {
    if (!adjusting || !fillable) return;
    const rect = e.currentTarget.getBoundingClientRect();
    commitSoon(zoomAt(frame, photoBox, framing, wheelFactor(e.deltaY), e.clientX - rect.left, e.clientY - rect.top));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!adjusting) return;
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      setAdjusting(false);
      return;
    }
    if (!fillable) return;
    const step = { x: frame.w * KEY_PAN_STEP, y: frame.h * KEY_PAN_STEP };
    const moves: Record<string, () => Framing> = {
      ArrowLeft: () => pan(frame, photoBox, framing, step.x, 0),
      ArrowRight: () => pan(frame, photoBox, framing, -step.x, 0),
      ArrowUp: () => pan(frame, photoBox, framing, 0, step.y),
      ArrowDown: () => pan(frame, photoBox, framing, 0, -step.y),
      "+": () => zoomAt(frame, photoBox, framing, KEY_ZOOM_STEP, frame.w / 2, frame.h / 2),
      "=": () => zoomAt(frame, photoBox, framing, KEY_ZOOM_STEP, frame.w / 2, frame.h / 2),
      "-": () => zoomAt(frame, photoBox, framing, 1 / KEY_ZOOM_STEP, frame.w / 2, frame.h / 2),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    commitSoon(move());
  };

  const classes = [
    "photo",
    `photo--${config.mat}`,
    `photo--${config.tone}`,
    adjusting ? "is-adjusting" : "",
    dropping ? "is-dropping" : "",
    photo ? "has-photo" : "",
  ];

  return (
    <Surface shape="card" w={spec.w} h={spec.h} label="Photo" className={classes.filter(Boolean).join(" ")}>
      <div
        ref={frameRef}
        className="photo__frame"
        tabIndex={adjusting ? 0 : -1}
        role={adjusting ? "application" : undefined}
        aria-label={adjusting ? "Adjust the photo: arrow keys move it, plus and minus zoom, Enter finishes" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
        onDoubleClick={() => adjusting && fillable && commit(CENTRED)}
      >
        {photo && placed ? (
          <img
            className="photo__img"
            src={photo.url}
            alt=""
            draggable={false}
            decoding="async"
            style={{ width: placed.width, height: placed.height, transform: `translate(${placed.left}px, ${placed.top}px)` }}
          />
        ) : null}
        {ready && !photo ? (
          <div className="photo-empty">
            <DotIcon name="photo" className="photo-empty__icon" />
            <div className="photo-empty__copy">
              <Caps>Photo</Caps>
              <span className="photo-empty__text">{problem ? PROBLEM_TEXT[problem] : spec.w > 2 ? "Drop a photo here, or choose one" : "Add a photo"}</span>
            </div>
            <button type="button" className="photo-empty__action" onClick={choose} disabled={!instanceId}>
              Choose photo
            </button>
          </div>
        ) : null}
      </div>

      {photo ? (
        <div className="photo__controls">
          {adjusting ? (
            <>
              <span className="photo__hint caps">{fillable ? "Drag to move, scroll to zoom" : "Fit shows the whole photo"}</span>
              {fillable ? <IconButton icon="reset" label="Centre the photo" size="sm" tone="ghost" onClick={() => commit(CENTRED)} /> : null}
              <IconButton icon="check" label="Done" size="sm" tone="accent" onClick={() => setAdjusting(false)} />
            </>
          ) : (
            <>
              {config.fit === "fill" ? (
                <IconButton
                  icon="move"
                  label="Adjust the photo"
                  size="sm"
                  onClick={() => {
                    setAdjusting(true);
                    requestAnimationFrame(() => frameRef.current?.focus());
                  }}
                />
              ) : null}
              <IconButton icon="image" label="Replace the photo" size="sm" onClick={choose} />
            </>
          )}
        </div>
      ) : null}
      {photo && problem ? <p className="photo__problem caps">{PROBLEM_TEXT[problem]}</p> : null}

      <input ref={input} className="photo__input" type="file" accept={ACCEPTED_TYPES.join(",")} tabIndex={-1} onChange={onPicked} />
    </Surface>
  );
}

export const photoWidget = defineWidget<PhotoConfig>({
  id: "photo",
  name: "Photo",
  description: "A photo of your own on the desktop, at full quality. Frame it, crop it, tint it with your theme.",
  category: "media",
  sizes: PHOTO_SIZES,
  providers: [],
  defaultConfig: DEFAULT_CONFIG,
  settingsSchema: PHOTO_SCHEMA,
  component: ({ config, size, instanceId }: WidgetProps<PhotoConfig>) => <PhotoWidget size={size} config={config} instanceId={instanceId} />,
});
