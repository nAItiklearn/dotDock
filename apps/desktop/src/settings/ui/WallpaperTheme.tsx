import { useMemo, useState } from "react";
import { getNativeApi } from "../../lib/native/api";
import { getApp } from "../../lib/state/app";
import { useGridMetrics } from "../../lib/state/useGridMetrics";
import { formatColor } from "../../lib/theme/color";
import { sampleImage } from "../../lib/theme/imageSample";
import { extractPalette, type WallpaperPalette } from "../../lib/theme/palette";
import { applyWallpaperTheme } from "../../lib/theme/wallpaperApply";
import {
  AA_TEXT,
  auditAa,
  buildThemeDoc,
  suggestMode,
  themeFromPalette,
  themeNameFor,
  type WallpaperMode,
} from "../../lib/theme/wallpaperTheme";
import { Button, Segmented } from "../../lib/ui/controls";
import { Icon } from "../../lib/ui/Icon";
import { pickFile } from "./download";
import { Section } from "./layout";
import { ThemePreview } from "./ThemePreview";
import { offerUndo } from "./undo";

type ModeChoice = "match" | WallpaperMode;

/** Where the colours came from: the wallpaper Windows is showing, or a picture the user chose. */
interface Source {
  readonly fileName: string | null;
}

type Analysis =
  | { readonly status: "idle" }
  | { readonly status: "reading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly serial: number; readonly source: Source; readonly palette: WallpaperPalette };

/** Tells one reading from the next, so choices made on the last one (accent, mode) do not carry over. */
let readings = 0;

const NO_COLOUR_NOTE = "This picture has almost no colour of its own, so the accent keeps the theme's own red.";

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : "The picture could not be read.";
}

async function analyse(read: () => Promise<Blob>, source: Source): Promise<Analysis> {
  try {
    const palette = extractPalette(await sampleImage(await read()));
    return palette
      ? { status: "ready", serial: (readings += 1), source, palette }
      : { status: "failed", message: "That picture is empty, so there are no colours to read." };
  } catch (error: unknown) {
    return { status: "failed", message: messageOf(error) };
  }
}

function Result({ source, palette }: { readonly source: Source; readonly palette: WallpaperPalette }) {
  const app = getApp();
  const metrics = useGridMetrics();
  const [modeChoice, setModeChoice] = useState<ModeChoice>("match");
  const [accentIndex, setAccentIndex] = useState(0);
  const mode: WallpaperMode = modeChoice === "match" ? suggestMode(palette) : modeChoice;
  const accent = palette.accents[accentIndex];

  const built = useMemo(() => {
    const theme = themeFromPalette(palette, mode, accent);
    return { theme, doc: buildThemeDoc(theme, mode, themeNameFor(source.fileName)), checks: auditAa(theme.colors) };
  }, [palette, mode, accent, source.fileName]);
  // The weakest pair is what a reader would notice; every pair, the accent included, is held to 4.5:1.
  const weakestText = Math.min(...built.checks.filter((c) => c.target === AA_TEXT).map((c) => c.ratio));
  const allPass = built.checks.every((c) => c.pass);

  const apply = (): void => {
    const result = applyWallpaperTheme(app.settings, built.doc);
    if (result.ok) {
      offerUndo(`${built.doc.name} is now your theme.`, result.undo);
    } else {
      app.notices.getState().push({ key: "wallpaper-theme", level: "error", message: result.reason });
    }
  };

  return (
    <div className="wptheme__result">
      <div className="wptheme__palette" role="img" aria-label="The colours found in the picture, widest first">
        {palette.swatches.map((s) => (
          <span key={formatColor(s.color)} style={{ flexGrow: s.share, background: formatColor(s.color) }} />
        ))}
      </div>

      <div className="wptheme__picks">
        <div className="wptheme__pick">
          <span className="row__label">Accent</span>
          {palette.accents.length > 0 ? (
            <span className="wptheme__accents" role="group" aria-label="Accent colour">
              {palette.accents.map((s, index) => (
                <button
                  key={formatColor(s.color)}
                  type="button"
                  className={`accent-pick${index === accentIndex ? " is-selected" : ""}`}
                  style={{ background: formatColor(s.color) }}
                  aria-pressed={index === accentIndex}
                  aria-label={`Use ${formatColor(s.color)} as the accent`}
                  onClick={() => setAccentIndex(index)}
                />
              ))}
            </span>
          ) : null}
        </div>
        <Segmented<ModeChoice>
          label="Theme is"
          value={modeChoice}
          options={[
            { value: "match", label: "Match picture" },
            { value: "dark", label: "Dark", icon: "moon" },
            { value: "light", label: "Light", icon: "sun" },
          ]}
          onChange={setModeChoice}
        />
      </div>

      {built.theme.accentFromPicture ? null : <p className="row__desc">{NO_COLOUR_NOTE}</p>}
      {built.theme.adjusted.includes("accent") ? (
        <p className="row__desc">The accent was nudged {mode === "dark" ? "lighter" : "darker"} so it reads as text and labels on it stay readable.</p>
      ) : null}

      <ThemePreview theme={built.doc} metrics={metrics} />

      <details className="wptheme__audit">
        <summary>
          <Icon name={allPass ? "check" : "warning"} size={14} />
          {allPass ? "Meets WCAG AA" : "Below WCAG AA"}: {built.checks.length} checks, text at least {weakestText.toFixed(1)}:1
        </summary>
        <ul className="contrast" aria-label="Contrast checks">
          {built.checks.map((check) => (
            <li key={check.label} className={`contrast__row${check.pass ? "" : " is-fail"}`}>
              <Icon name={check.pass ? "check" : "warning"} size={14} />
              <span className="contrast__label">{check.label}</span>
              <span className="contrast__ratio tabular">{check.ratio.toFixed(1)}:1</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="editor__actions">
        <Button variant="primary" icon="check" onClick={apply}>
          Apply theme
        </Button>
      </div>
    </div>
  );
}

/** Build a theme from the user's own wallpaper, or any picture: look at the palette, preview, apply, undo. */
export function WallpaperThemeSection() {
  const [analysis, setAnalysis] = useState<Analysis>({ status: "idle" });
  const native = getNativeApi();

  const run = (read: () => Promise<Blob>, source: Source): void => {
    setAnalysis({ status: "reading" });
    void analyse(read, source).then(setAnalysis);
  };
  const useCurrent = (): void => run(() => native.wallpapers.currentImage(), { fileName: null });
  const choose = (): void => {
    void pickFile("image/*").then((file) => {
      if (file) run(() => Promise.resolve(file), { fileName: file.name });
    });
  };

  return (
    <Section
      title="From your wallpaper"
      description="Take the colours of your own picture, the one on your desktop or any other, and build a theme from them. Text stays readable whatever the picture."
    >
      <div className="row row--block" data-setting-id="wallpaper-theme">
        <div className="wptheme">
          <div className="wptheme__sources">
            <Button icon="wallpaper" disabled={!native.available || analysis.status === "reading"} onClick={useCurrent}>
              Use my current wallpaper
            </Button>
            <Button icon="upload" disabled={analysis.status === "reading"} onClick={choose}>
              Choose a picture…
            </Button>
          </div>
          {native.available ? null : (
            <p className="row__desc">Reading the wallpaper Windows is showing needs the desktop app. Choosing a picture works here.</p>
          )}
          {analysis.status === "reading" ? (
            <p className="row__desc" role="status">
              Reading the colours…
            </p>
          ) : null}
          {analysis.status === "failed" ? (
            <div className="banner banner--error" role="alert">
              <Icon name="warning" size={18} />
              <div>{analysis.message}</div>
            </div>
          ) : null}
          {analysis.status === "ready" ? <Result key={analysis.serial} source={analysis.source} palette={analysis.palette} /> : null}
        </div>
      </div>
    </Section>
  );
}
