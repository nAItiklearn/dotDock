import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DotIcon } from "../../design-system/DotMatrix";
import { DOT_ICON_NAMES } from "../../design-system/icons";
import { Caps } from "../../design-system/primitives";
import "../../design-system/tokens.css";
import { applyTheme, themeById } from "../../design-system/themes";
import { WIDGETS } from "../registry";
import { WidgetView } from "../WidgetView";
import { applyGalleryState, GALLERY_STATES, type GalleryState } from "./fixtures";
import "./gallery.css";

/**
 * Developer harness: every registered widget, at every size, in any theme and provider state.
 *   ?theme=obsidian|paper|aurum   ?state=live|cache|offline|empty|error|loading
 *   ?only=clock,weather           ?sizes=m,l (limit sizes)   ?variants=0 (skip config variants)
 *   ?icons=1                      shows the dot-matrix pictograms instead of widgets
 */
const params = new URLSearchParams(location.search);
const stateParam = params.get("state") ?? "live";
const state: GalleryState = GALLERY_STATES.find((s) => s === stateParam) ?? "live";
const only = params.get("only")?.split(",") ?? null;
const sizeFilter = params.get("sizes")?.split(",") ?? null;
const withVariants = params.get("variants") !== "0";
const showIcons = params.get("icons") === "1";
const ICON_PREVIEW_SIZE = 54;

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
};

applyTheme(themeById(params.get("theme") ?? "obsidian"));
applyGalleryState(state);

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

function Gallery() {
  const widgets = WIDGETS.filter((w) => !showIcons && (only === null || only.includes(w.id)));
  return (
    <main className="gallery">
      <header className="gallery__bar">
        <Caps accent>{`${themeById(params.get("theme") ?? "obsidian").name} · ${state}`}</Caps>
      </header>
      {showIcons ? <Pictograms /> : null}
      {widgets.map((def) => {
        const variants = withVariants ? (VARIANTS[def.id] ?? BASE) : BASE;
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
                    <WidgetView id={def.id} size={size.id} config={variant.config} />
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

void document.fonts.ready.then(() => {
  createRoot(root).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
});
