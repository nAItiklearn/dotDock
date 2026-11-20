import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { DotIcon } from "../../design-system/DotMatrix";
import { DOT_ICON_NAMES } from "../../design-system/icons";
import { Caps } from "../../design-system/primitives";
import "../../design-system/tokens.css";
import { applyTheme, themeById } from "../../design-system/themes";
import { ConfigForm } from "../../lib/ui/ConfigForm";
import "../../overlay/edit/edit.css";
import { normalizeConfig } from "../configSchema";
import { PHOTO_SCHEMA } from "../photo/config";
import { CENTRED } from "../photo/frame";
import { WIDGETS } from "../registry";
import { WidgetView } from "../WidgetView";
import { applyGalleryState, GALLERY_STATES, type GalleryState } from "./fixtures";
import { BENCH_ID, PerfBench } from "./perfBench";
import { DEFAULT_SAMPLE_PHOTO, seedPhotos } from "./photoFixture";
import "./gallery.css";

/**
 * Developer harness: every registered widget, at every size, in any theme and provider state.
 *   ?theme=obsidian|paper|aurum   ?state=live|cache|offline|empty|error|loading
 *   ?only=clock,weather           ?sizes=m,l (limit sizes)   ?variants=0 (skip config variants)
 *   ?icons=1                      shows the dot-matrix pictograms instead of widgets
 *   ?code=61&night=1              weather sample: WMO code, and night time
 *   ?photo=<url>                  the photo widget's sample picture (default: a wallpaper thumbnail)
 *   ?focus=0.5,0.4,1              its framing: focal x, focal y, zoom
 *   ?panel=1                      the photo widget next to its live settings panel
 *   ?empty=1                      the photo widget without a picture
 *   ?wallpaper=<url>              a desktop wallpaper behind the page instead of the theme background
 *   ?perf=<url>,<url>,…           one photo widget for the frame-time bench, swapping these pictures
 */
const params = new URLSearchParams(location.search);
const stateParam = params.get("state") ?? "live";
const state: GalleryState = GALLERY_STATES.find((s) => s === stateParam) ?? "live";
const only = params.get("only")?.split(",") ?? null;
const sizeFilter = params.get("sizes")?.split(",") ?? null;
const withVariants = params.get("variants") !== "0";
const labelFilter = params.get("labels")?.split(",") ?? null;
const variantsOf = (id: string): readonly Variant[] =>
  (withVariants ? (VARIANTS[id] ?? BASE) : BASE).filter((v) => labelFilter === null || labelFilter.includes(v.label));
const showIcons = params.get("icons") === "1";
const ICON_PREVIEW_SIZE = 72;

interface Variant {
  readonly label: string;
  readonly config: Readonly<Record<string, unknown>>;
}

const BASE: readonly Variant[] = [{ label: "default", config: {} }];

const VARIANTS: Readonly<Record<string, readonly Variant[]>> = {
  clock: [
    { label: "split bold", config: { matrixStyle: "blocks", showSeconds: true } },
    { label: "filled circles", config: { matrixStyle: "circles", blinkColon: true } },
    { label: "striped lines", config: { matrixStyle: "stripes" } },
    { label: "dot matrix", config: { matrixStyle: "dots" } },
    { label: "pill", config: { matrixStyle: "pill", showSeconds: true } },
    { label: "12-hour", config: { matrixStyle: "circles", hour24: false, zone: "new-york" } },
  ],
  system: [
    { label: "memory", config: { metric: "ram" } },
    { label: "processor", config: { metric: "cpu" } },
    { label: "drive", config: { metric: "disk" } },
  ],
  weather: [
    { label: "celsius", config: { unit: "c" } },
    { label: "fahrenheit", config: { unit: "f" } },
  ],
  calendar: [
    { label: "auto week", config: {} },
    { label: "sunday, week numbers", config: { weekStart: "sun", showWeekNumbers: true } },
  ],
  photo: [
    { label: "edge to edge", config: {} },
    { label: "keyline", config: { frame: "hairline" } },
    { label: "mat", config: { frame: "mat" } },
    { label: "polaroid", config: { frame: "polaroid", caption: "Birthday, 20 Nov" } },
    { label: "dots", config: { frame: "dots", tint: "paper" } },
    { label: "squircle", config: { shape: "squircle" } },
    { label: "circle", config: { shape: "circle" } },
    { label: "circle dots", config: { frame: "dots", shape: "circle", tint: "accent" } },
    { label: "circle mat", config: { frame: "mat", shape: "circle", tint: "ink" } },
    { label: "ink mat, square, flat", config: { frame: "mat", tint: "ink", radius: 0, thickness: 20, shadow: false } },
    { label: "accent keyline, squircle", config: { frame: "hairline", tint: "accent", shape: "squircle", thickness: 8 } },
    { label: "ink polaroid, mono", config: { frame: "polaroid", tint: "ink", tone: "mono", caption: "Kyoto" } },
    { label: "grey polaroid", config: { frame: "polaroid", tint: "dim", caption: "Ridge at dusk" } },
    { label: "accent polaroid", config: { frame: "polaroid", tint: "accent", caption: "First light" } },
  ],
};

const photoUrl = params.get("photo") ?? DEFAULT_SAMPLE_PHOTO;
const [focusX, focusY, focusZoom] = (params.get("focus") ?? "").split(",").map(Number);
const photoFraming =
  focusX === undefined || focusY === undefined || focusZoom === undefined
    ? CENTRED
    : { x: focusX, y: focusY, zoom: focusZoom };
const showPhotoEmpty = params.get("empty") === "1";
const benchPhotos = params.get("perf")?.split(",") ?? null;
/**
 * Placement id of one photo case in the gallery; the picture is stored under it like a real
 * widget's. Empty cases use ids that are never stored, so they stay empty across reloads.
 */
const photoId = (...parts: readonly string[]): string =>
  `gallery${showPhotoEmpty ? "-empty" : ""}-${parts.join("-").replaceAll(" ", "-")}`;

applyTheme(themeById(params.get("theme") ?? "obsidian"));
const wallpaper = params.get("wallpaper");
if (wallpaper) {
  document.documentElement.style.setProperty("--gallery-wallpaper", `url("${CSS.escape(wallpaper)}")`);
  document.documentElement.classList.add("gallery--wallpaper");
}
const weatherCode = params.get("code");
applyGalleryState(state, {
  ...(weatherCode === null ? {} : { code: Number(weatherCode) }),
  ...(params.get("night") === "1" ? { isDay: false } : {}),
});

const root = document.getElementById("root");
if (!root) throw new Error("gallery index.html is missing #root");

function Pictograms() {
  return (
    <section className="gallery__widget">
      <h2 className="gallery__name">
        <Caps>Pictograms</Caps>
      </h2>
      <div className="gallery__row">
        {DOT_ICON_NAMES.map((name) => (
          <figure key={name} className="gallery__case">
            <DotIcon name={name} size={ICON_PREVIEW_SIZE} />
            <figcaption className="gallery__caption">
              <Caps>{name}</Caps>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

const PANEL_START: readonly Variant[] = [
  { label: "edge to edge", config: {} },
  { label: "polaroid", config: { frame: "polaroid", caption: "Birthday, 20 Nov" } },
  { label: "dots", config: { frame: "dots", tint: "paper", shape: "circle" } },
];

/** The photo widget beside its settings panel: changing a setting changes the widget at once. */
function PhotoPanel({ start }: { readonly start: Variant }) {
  const [config, setConfig] = useState<Readonly<Record<string, unknown>>>(start.config);
  const resolved = normalizeConfig(PHOTO_SCHEMA, config);
  const id = photoId("panel", start.label);
  return (
    <figure className="gallery__case">
      <WidgetView id="photo" size="medium" config={config} instanceId={id} />
      <div className="gallery__panel">
        <ConfigForm schema={PHOTO_SCHEMA} size="medium" config={resolved} onChange={(key, value) => setConfig((now) => ({ ...now, [key]: value }))} />
      </div>
      <figcaption className="gallery__caption">
        <Caps>{`settings panel · ${start.label}`}</Caps>
      </figcaption>
    </figure>
  );
}

function PhotoPanels() {
  return (
    <section className="gallery__widget">
      <h2 className="gallery__name">
        <Caps>Photo settings panel</Caps>
      </h2>
      <div className="gallery__row">
        {PANEL_START.map((start) => (
          <PhotoPanel key={start.label} start={start} />
        ))}
      </div>
    </section>
  );
}

/** Every placement id the photo widget uses in this page, so each can be given the sample picture. */
function photoPlacements(): readonly string[] {
  const def = WIDGETS.find((w) => w.id === "photo");
  if (!def || (only !== null && !only.includes("photo"))) return [];
  const sizes = def.sizes.filter((s) => sizeFilter === null || sizeFilter.includes(s.id));
  const variants = variantsOf("photo");
  const cases = variants.flatMap((variant) => sizes.map((size) => photoId(variant.label, size.id)));
  return params.get("panel") === "1" ? [...cases, ...PANEL_START.map((start) => photoId("panel", start.label))] : cases;
}

function Gallery() {
  if (benchPhotos) {
    return (
      <main className="gallery">
        <PerfBench photos={benchPhotos} config={{ frame: "dots", tint: "accent" }} />
      </main>
    );
  }
  const widgets = WIDGETS.filter((w) => !showIcons && (only === null || only.includes(w.id)));
  return (
    <main className="gallery">
      <header className="gallery__bar">
        <Caps accent>{`${themeById(params.get("theme") ?? "obsidian").name} · ${state}`}</Caps>
      </header>
      {showIcons ? <Pictograms /> : null}
      {params.get("panel") === "1" ? <PhotoPanels /> : null}
      {widgets.map((def) => {
        if (params.get("panel") === "1" && def.id === "photo") return null;
        const variants = variantsOf(def.id);
        const sizes = def.sizes.filter((s) => sizeFilter === null || sizeFilter.includes(s.id));
        return (
          <section key={def.id} className="gallery__widget">
            <h2 className="gallery__name">
              <Caps>{def.name}</Caps>
            </h2>
            <div className="gallery__row">
              {variants.flatMap((variant) =>
                sizes.map((size) => (
                  <figure key={`${variant.label}:${size.id}`} className="gallery__case">
                    <WidgetView
                      id={def.id}
                      size={size.id}
                      config={variant.config}
                      instanceId={def.id === "photo" ? photoId(variant.label, size.id) : undefined}
                    />
                    <figcaption className="gallery__caption">
                      <Caps>{`${size.id} · ${size.w}×${size.h} · ${size.name}${variant.label === "default" ? "" : ` · ${variant.label}`}`}</Caps>
                    </figcaption>
                  </figure>
                )),
              )}
            </div>
          </section>
        );
      })}
    </main>
  );
}

/** Photos are stored before the first render so no case flashes its empty state. */
async function prepare(): Promise<void> {
  await document.fonts.ready;
  if (benchPhotos?.[0]) await seedPhotos([BENCH_ID], benchPhotos[0]);
  else if (!showPhotoEmpty) await seedPhotos(photoPlacements(), photoUrl, photoFraming);
}

void prepare().then(() => {
  createRoot(root).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
});
