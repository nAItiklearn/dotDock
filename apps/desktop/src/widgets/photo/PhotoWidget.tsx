import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";
import { flushSync } from "react-dom";
import { DotIcon } from "../../design-system/DotMatrix";
import { Caps, IconButton, Surface } from "../../design-system/primitives";
import { watchTheme } from "../../design-system/themes";
import { isTauri } from "../../providers/bridge";
import { defineWidget, type WidgetProps } from "../definition";
import { sizeSpec, type SizeId } from "../sizes";
import { ACCEPTED_TYPES, loadPhoto, readPhotoFile, savePhoto, type PhotoProblem, type StoredPhoto } from "./blobs";
import { DEFAULT_PHOTO_CONFIG, PHOTO_SCHEMA, PHOTO_SIZES, type PhotoConfig } from "./config";
import { bitmapCache, bucketWidth, CacheDisposedError, drawCopy, type CopyCache } from "./decode";
import {
  CENTRED,
  clampFraming,
  KEY_PAN_STEP,
  KEY_ZOOM_STEP,
  pan,
  place,
  wheelFactor,
  zoomAt,
  type Box,
  type Framing,
} from "./frame";
import { captionInk, readInkInputs, type CaptionInk } from "./ink";
import { dotsPath, layoutFrame, lookOf, lookVars, type PhotoTint } from "./look";
import { EMPTY_ENTRY, usePhotoStore } from "./store";
import "./PhotoWidget.css";

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
  /** Decoded copies of the stored file, one per size bucket it has been shown at. */
  readonly copies: CopyCache<ImageBitmap>;
  readonly width: number;
  readonly height: number;
  /** Unique per load, so a replaced photo gets a fresh canvas only once the new file is read. */
  readonly key: number;
}

let loads = 0;

/**
 * The stored photo for an instance, reloaded whenever its revision changes. The photo on screen
 * stays until the replacement has been read, and its decoded copies are released only then (or
 * when the widget goes), so a replace never shows a blank frame.
 */
function usePhoto(id: string | undefined, rev: number): { readonly photo: Loaded | null; readonly ready: boolean } {
  const [state, setState] = useState<{ photo: Loaded | null; ready: boolean }>({ photo: null, ready: false });
  useEffect(() => {
    if (id === undefined) return undefined;
    let live = true;
    loadPhoto(id)
      .then((stored) => {
        if (!live) return;
        if (!stored) {
          setState({ photo: null, ready: true });
          return;
        }
        loads += 1;
        const copies = bitmapCache(stored.blob, stored.width, stored.height);
        setState({ photo: { copies, width: stored.width, height: stored.height, key: loads }, ready: true });
      })
      .catch((err: unknown) => {
        console.error("photo load failed", err);
        if (live) setState({ photo: null, ready: true });
      });
    return () => {
      live = false;
    };
  }, [id, rev]);
  const shown = state.photo;
  useEffect(() => () => shown?.copies.dispose(), [shown]);
  // Without a placement id (previews) there is nothing to load: the empty state shows at once.
  return id === undefined ? { photo: null, ready: true } : state;
}

/** The display's device pixel ratio, updated when the window moves to a screen with another scale. */
function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio);
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`);
    const changed = (): void => setRatio(window.devicePixelRatio);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, [ratio]);
  return ratio;
}

/**
 * Draws the copy of the photo decoded for `width` device px into the canvas. The copy is decoded
 * off the main thread; until it is ready the canvas keeps the copy it already shows, which the
 * compositor scales, so a new size never blocks a frame. Returns whether anything is drawn yet.
 */
function useCopy(
  canvas: RefObject<HTMLCanvasElement | null>,
  photo: Loaded | null,
  width: number,
  drawn: () => void,
  failed: () => void,
): boolean {
  const [shown, setShown] = useState(false);
  // A new photo gets a new canvas, which fades in once its first copy is drawn.
  useEffect(() => setShown(false), [photo]);
  useEffect(() => {
    if (!photo || width <= 0) return undefined;
    let live = true;
    drawCopy(photo.copies, width, () => live, () => canvas.current, (copy) => createImageBitmap(copy))
      .then((result) => {
        if (result !== "drawn") return;
        setShown(true);
        drawn();
      })
      .catch((err: unknown) => {
        // A released photo was replaced or removed; its successor draws itself.
        if (!live || err instanceof CacheDisposedError) return;
        console.error("photo decode failed", err);
        failed();
      });
    return () => {
      live = false;
    };
  }, [canvas, photo, width, drawn, failed]);
  return shown;
}

/**
 * The token a polaroid's caption is printed in, measured against the border colour the stylesheet
 * resolved, and again whenever the theme changes. Null until measured, or when a colour is not a
 * plain one; the stylesheet's default ink applies then.
 */
function useCaptionInk(stage: RefObject<HTMLElement | null>, tint: PhotoTint): CaptionInk | null {
  const [ink, setInk] = useState<CaptionInk | null>(null);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const measure = (): void => {
      const inputs = readInkInputs(getComputedStyle(el));
      setInk(inputs ? captionInk(inputs.line, inputs.backdrop, inputs.palette) : null);
    };
    measure();
    return watchTheme(measure);
  }, [stage, tint]);
  return ink;
}

/**
 * The element's layout size in CSS px. A resize is applied before the next paint (flushSync), so
 * the photo is never drawn for a moment at the old size inside the new frame.
 */
function useBox<T extends HTMLElement>(): [RefObject<T | null>, Box] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox((now) => (now.w === w && now.h === h ? now : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(() => flushSync(measure));
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

export function PhotoWidget({ size = "l", config = DEFAULT_PHOTO_CONFIG, instanceId }: PhotoWidgetProps) {
  const spec = sizeSpec(PHOTO_SIZES, size);
  const entry = usePhotoStore((s) => (instanceId ? s.entries[instanceId] : undefined)) ?? EMPTY_ENTRY;
  const { photo, ready } = usePhoto(instanceId, entry.rev);
  // The stage fills the widget. Its measured size gives the border layout, and the layout gives the
  // photo window, so a resize re-places the photo from the saved framing without losing it.
  const [stageRef, card] = useBox<HTMLDivElement>();
  const look = useMemo(() => lookOf(config), [config]);
  const layout = useMemo(() => layoutFrame(look, card), [look, card]);
  const frame = layout.window;
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ink = useCaptionInk(stageRef, look.tint);
  // A resize is a snap between footprints and is drawn at once; only a change of look eases.
  const lastCard = useRef<Box | null>(null);
  const resized = lastCard.current?.w !== card.w || lastCard.current.h !== card.h;
  useLayoutEffect(() => {
    lastCard.current = card;
  }, [card]);
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
  // A new file starts centred (the store resets its framing); a zoom of the old one still waiting
  // to be saved must not land on it.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    setDraft(null);
  }, [entry.rev]);
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
  const pixelRatio = useDevicePixelRatio();
  // The copy is decoded for the size the photo fills at its saved framing. During a zoom gesture
  // the compositor scales the current copy, so each wheel notch does not start a full decode.
  const drawnWidth = photo ? place(frame, photoBox, config.fit, entry.framing).width * pixelRatio : 0;
  const decodeFailed = useCallback(() => setProblem("decode"), []);
  const decodeRecovered = useCallback(() => setProblem((now) => (now === "decode" ? null : now)), []);
  const shown = useCopy(canvasRef, photo, photo ? bucketWidth(drawnWidth, photo.width) : 0, decodeRecovered, decodeFailed);

  const controlsRef = useRef<HTMLDivElement>(null);
  // The Done button unmounts as adjusting ends; focus returns to the Adjust button that replaces it.
  const finishAdjusting = (): void => {
    setAdjusting(false);
    requestAnimationFrame(() => controlsRef.current?.querySelector("button")?.focus());
  };

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
      e.stopPropagation();
      finishAdjusting();
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
    `photo--frame-${look.frame}`,
    `photo--shape-${look.shape}`,
    `photo--tint-${look.tint}`,
    `photo--tone-${config.tone}`,
    `photo--fit-${config.fit}`,
    resized ? "photo--snap" : "",
    look.shadow ? "" : "photo--flat",
    adjusting ? "is-adjusting" : "",
    dropping ? "is-dropping" : "",
    photo ? "has-photo" : "",
  ];
  const vars = { ...lookVars(look, layout, card), ...(ink ? { "--photo-line-ink": `var(${ink})` } : {}) } as CSSProperties;
  // The stylesheet places the photo from these against the window's live size, so the photo
  // covers its window in every frame while a border change eases (the same rule as `place`).
  const shownFraming = config.fit === "fill" ? clampFraming(framing) : CENTRED;
  const photoVars = photo
    ? ({
        "--photo-aspect": photo.width / photo.height,
        "--photo-zoom": shownFraming.zoom,
        "--photo-fx": shownFraming.x,
        "--photo-fy": shownFraming.y,
      } as CSSProperties)
    : undefined;

  return (
    <Surface shape="card" w={spec.w} h={spec.h} label="Photo" className={classes.filter(Boolean).join(" ")} style={vars}>
      <div ref={stageRef} className="photo__stage">
        {layout.dots.length > 0 ? (
          // A changed ring fades in rather than jumping; a resize redraws it in place.
          <svg key={`${look.shape}-${look.radius}-${look.thickness}`} className="photo__dots" width={card.w} height={card.h} aria-hidden="true">
            <path d={dotsPath(layout.dots, layout.dotRadius)} />
          </svg>
        ) : null}
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
          {photo ? (
            <canvas key={photo.key} ref={canvasRef} className={`photo__img${shown ? " is-shown" : ""}`} style={photoVars} aria-hidden="true" />
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
        {look.frame === "polaroid" ? <p className="photo__caption caps" dir="auto">{look.caption}</p> : null}
      </div>

      {photo ? (
        <div ref={controlsRef} className="photo__controls">
          {adjusting ? (
            <>
              <span className="photo__hint caps">{fillable ? "Drag to move, scroll to zoom" : "Fit shows the whole photo"}</span>
              {fillable ? <IconButton icon="reset" label="Centre the photo" size="sm" tone="ghost" onClick={() => commit(CENTRED)} /> : null}
              <IconButton icon="check" label="Done" size="sm" tone="accent" onClick={finishAdjusting} />
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
  description: "A photo of your own on the desktop, at full quality. Crop it, frame it as a mat, polaroid or dot border, tint it with your theme.",
  category: "media",
  sizes: PHOTO_SIZES,
  providers: [],
  defaultConfig: DEFAULT_PHOTO_CONFIG,
  settingsSchema: PHOTO_SCHEMA,
  component: ({ config, size, instanceId }: WidgetProps<PhotoConfig>) => <PhotoWidget size={size} config={config} instanceId={instanceId} />,
});
