import { useState } from "react";
import type { Theme } from "../../design-system/themes";
import { DEFAULT_SETTINGS, LIMITS } from "../../lib/model/defaults";
import type { MotionPreference, ThemeMode, UiFont } from "../../lib/model/types";
import { getApp } from "../../lib/state/app";
import { useSettingsStore } from "../../lib/state/hooks";
import { allThemes, DEFAULT_CORNER_RADIUS, findTheme, resolveThemeId } from "../../lib/theme/appearance";
import { serializeTheme, themeFileName, themeToDoc, type ThemeDoc } from "../../lib/theme/schema";
import { Button, IconButton, Segmented, SelectField, Slider, TextField } from "../../lib/ui/controls";
import { Icon } from "../../lib/ui/Icon";
import { downloadText, pickTextFile } from "../ui/download";
import { PageHeader, Row, Section } from "../ui/layout";
import { ThemeEditor } from "../ui/ThemeEditor";
import { WallpaperThemeSection } from "../ui/WallpaperTheme";
import { offerUndo } from "../ui/undo";
import { pageById } from "../pageMeta";

const MODE_OPTIONS: readonly { value: ThemeMode; label: string }[] = [
  { value: "fixed", label: "One theme" },
  { value: "system", label: "Follow Windows" },
  { value: "schedule", label: "On a schedule" },
];

function ThemeCard({ theme, selected, onSelect }: { readonly theme: Theme; readonly selected: boolean; readonly onSelect: () => void }) {
  const c = theme.colors;
  return (
    <button type="button" className={`theme-card${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={onSelect}>
      <span className="theme-card__swatch" style={{ background: c.bg, borderColor: c.border }} aria-hidden="true">
        <span className="theme-card__chip" style={{ background: c.surface, borderColor: c.border }}>
          <span className="theme-card__dot" style={{ background: c.accent }} />
          <span className="theme-card__line" style={{ background: c.text }} />
          <span className="theme-card__line theme-card__line--short" style={{ background: c.textDim }} />
        </span>
        <span className="theme-card__ring" style={{ borderColor: c.dotOff }}>
          <span className="theme-card__arc" style={{ color: c.accent }} />
        </span>
      </span>
      <span className="theme-card__name">{theme.name}</span>
      <span className="caps">{theme.mode === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}

function ThemeChoice() {
  const app = getApp();
  const sel = useSettingsStore((s) => s.settings.theme);
  const custom = useSettingsStore((s) => s.customThemes);
  const themes = allThemes(custom);
  const d = DEFAULT_SETTINGS.theme;
  const setTheme = (patch: Partial<typeof sel>): void => app.settings.getState().update((s) => ({ ...s, theme: { ...s.theme, ...patch } }));
  const pickable = (mode: "light" | "dark"): readonly { value: string; label: string }[] =>
    themes.filter((t) => t.mode === mode).map((t) => ({ value: t.id, label: t.name }));
  const knownIds = new Set(themes.map((t) => t.id));

  return (
    <Section title="Theme" description="Colours for every widget. Pick one, follow Windows, or switch at set times.">
      <Row
        id="theme-switch"
        label="Switch automatically"
        description="Follow the Windows light and dark setting, or change theme by time of day."
        isDefault={sel.mode === d.mode}
        onReset={() => setTheme({ mode: d.mode })}
      >
        <Segmented label="Switch automatically" value={sel.mode} options={MODE_OPTIONS} onChange={(mode) => setTheme({ mode })} />
      </Row>
      <div className="row row--block" data-setting-id="theme">
        {sel.mode === "fixed" ? (
          <div className="theme-grid" role="group" aria-label="Themes">
            {themes.map((t) => (
              <ThemeCard key={t.id} theme={t} selected={t.id === sel.fixedId || (!knownIds.has(sel.fixedId) && t.id === "obsidian")} onSelect={() => setTheme({ fixedId: t.id })} />
            ))}
          </div>
        ) : (
          <div className="pair">
            <div className="pair__item">
              <span className="row__label">Light theme</span>
              <SelectField label="Light theme" value={sel.lightId} options={pickable("light")} onChange={(lightId) => setTheme({ lightId })} />
            </div>
            <div className="pair__item">
              <span className="row__label">Dark theme</span>
              <SelectField label="Dark theme" value={sel.darkId} options={pickable("dark")} onChange={(darkId) => setTheme({ darkId })} />
            </div>
            {sel.mode === "schedule" ? (
              <>
                <div className="pair__item">
                  <span className="row__label">Light from</span>
                  <TextField label="Light theme starts at" type="time" value={sel.lightFrom} onChange={(lightFrom) => setTheme({ lightFrom })} />
                </div>
                <div className="pair__item">
                  <span className="row__label">Dark from</span>
                  <TextField label="Dark theme starts at" type="time" value={sel.darkFrom} onChange={(darkFrom) => setTheme({ darkFrom })} />
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </Section>
  );
}

function CustomThemes() {
  const app = getApp();
  const custom = useSettingsStore((s) => s.customThemes);
  const sel = useSettingsStore((s) => s.settings.theme);
  const [editing, setEditing] = useState<string | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);

  const baseTheme = (): Theme => findTheme(resolveThemeId(sel, new Date(), window.matchMedia("(prefers-color-scheme: dark)").matches), custom);
  const create = (base: Theme, name: string): void => {
    const settings = app.settings.getState();
    const doc = themeToDoc(base, settings.newThemeId(name), name);
    settings.saveTheme(doc);
    setEditing(doc.id);
  };
  const importFile = (): void => {
    void pickTextFile(".json,application/json").then((file) => {
      if (!file) return;
      const result = app.settings.getState().importTheme(file.text);
      if (result.ok) {
        setProblems([]);
        setEditing(result.theme.id);
      } else {
        setProblems(result.errors);
      }
    });
  };
  const duplicate = (t: ThemeDoc): void => {
    const name = `${t.name} copy`.slice(0, LIMITS.themeNameLength);
    const settings = app.settings.getState();
    const copy = { ...t, id: settings.newThemeId(name), name };
    settings.saveTheme(copy);
    setEditing(copy.id);
  };
  const remove = (t: ThemeDoc): void => {
    app.settings.getState().deleteTheme(t.id);
    if (editing === t.id) setEditing(null);
    offerUndo(`${t.name} deleted.`, () => app.settings.getState().saveTheme(t));
  };

  const base = baseTheme();
  return (
    <Section
      title="Your themes"
      description="Make a theme from any colour, edit every role, and share it as a file."
      actions={
        <div className="section__buttons">
          <Button icon="upload" onClick={importFile}>
            Import
          </Button>
          <Button variant="primary" icon="plus" onClick={() => create(base, `${base.name} custom`.slice(0, LIMITS.themeNameLength))} disabled={custom.length >= LIMITS.maxCustomThemes}>
            New theme
          </Button>
        </div>
      }
    >
      <div className="row row--block" data-setting-id="custom-themes">
        {problems.length > 0 ? (
          <div className="banner banner--error" role="alert">
            <Icon name="warning" size={18} />
            <div>
              <strong>That file isn't a usable theme.</strong>
              <ul>
                {problems.slice(0, 5).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            <IconButton icon="close" label="Dismiss" onClick={() => setProblems([])} />
          </div>
        ) : null}
        {custom.length === 0 ? (
          <p className="empty">
            <span className="caps">No custom themes</span>
            New theme starts from the one you're using now ({base.name}), so you only change what you want to.
          </p>
        ) : (
          <ul className="list" aria-label="Custom themes">
            {custom.map((t) => (
              <li key={t.id} className={`list__row${editing === t.id ? " is-active" : ""}`}>
                <span className="list__lead" aria-hidden="true">
                  <span className="swatch" style={{ background: t.colors.accent }} />
                </span>
                <div className="list__main">
                  <span className="list__title">{t.name}</span>
                  <span className="caps">{t.mode === "dark" ? "Dark" : "Light"}</span>
                </div>
                <div className="list__actions">
                  <Button onClick={() => setEditing(editing === t.id ? null : t.id)} aria-expanded={editing === t.id}>
                    {editing === t.id ? "Close" : "Edit"}
                  </Button>
                  <IconButton icon="duplicate" label={`Duplicate ${t.name}`} onClick={() => duplicate(t)} />
                  <IconButton icon="download" label={`Export ${t.name}`} onClick={() => downloadText(themeFileName(t), serializeTheme(t))} />
                  <IconButton icon="trash" tone="danger" label={`Delete ${t.name}`} onClick={() => remove(t)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing ? <ThemeEditor themeId={editing} onClose={() => setEditing(null)} /> : null}
    </Section>
  );
}

function ShapeAndMotion() {
  const app = getApp();
  const appearance = useSettingsStore((s) => s.settings.appearance);
  const d = DEFAULT_SETTINGS.appearance;
  const set = (patch: Partial<typeof appearance>): void => app.settings.getState().update((s) => ({ ...s, appearance: { ...s.appearance, ...patch } }));
  const radius = appearance.cornerRadius ?? DEFAULT_CORNER_RADIUS;
  return (
    <Section title="Shape and motion">
      <Row
        id="radius"
        label="Corner roundness"
        description="How round widget cards are. Pills and circles stay as they are."
        isDefault={appearance.cornerRadius === d.cornerRadius}
        onReset={() => set({ cornerRadius: d.cornerRadius })}
      >
        <span className="control-with-value">
          <Slider label="Corner roundness" value={radius} {...LIMITS.cornerRadius} valueText={`${radius} pixels`} onChange={(cornerRadius) => set({ cornerRadius })} />
          <span className="control-value tabular">{appearance.cornerRadius === null ? "Default" : `${radius} px`}</span>
        </span>
      </Row>
      <Row
        id="motion"
        label="Motion"
        description="Follow the Windows animation setting, always animate, or keep everything still."
        isDefault={appearance.motion === d.motion}
        onReset={() => set({ motion: d.motion })}
      >
        <Segmented<MotionPreference>
          label="Motion"
          value={appearance.motion}
          options={[
            { value: "system", label: "Follow Windows" },
            { value: "full", label: "Always" },
            { value: "reduced", label: "Still" },
          ]}
          onChange={(motion) => set({ motion })}
        />
      </Row>
      <Row
        id="motion-speed"
        label="Animation speed"
        description="Scales every transition, from a hover to a widget settling into its cell."
        isDefault={appearance.motionSpeed === d.motionSpeed}
        onReset={() => set({ motionSpeed: d.motionSpeed })}
      >
        <span className="control-with-value">
          <Slider
            label="Animation speed"
            value={appearance.motionSpeed}
            {...LIMITS.motionSpeed}
            disabled={appearance.motion === "reduced"}
            valueText={`${appearance.motionSpeed} times`}
            onChange={(motionSpeed) => set({ motionSpeed })}
          />
          <span className="control-value tabular">{appearance.motionSpeed}×</span>
        </span>
      </Row>
      <Row
        id="font"
        label="Interface font"
        description="The typeface for labels and text on widgets. Dot-matrix numerals are not affected."
        isDefault={appearance.font === d.font}
        onReset={() => set({ font: d.font })}
      >
        <Segmented<UiFont>
          label="Interface font"
          value={appearance.font}
          options={[
            { value: "sans", label: "Sans" },
            { value: "mono", label: "Mono" },
          ]}
          onChange={(font) => set({ font })}
        />
      </Row>
    </Section>
  );
}

export function AppearancePage() {
  const page = pageById("appearance");
  return (
    <>
      <PageHeader title={page.title} description={page.description} />
      <ThemeChoice />
      <WallpaperThemeSection />
      <CustomThemes />
      <ShapeAndMotion />
    </>
  );
}
