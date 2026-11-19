import { useEffect, useState } from "react";
import { LIMITS } from "../../lib/model/defaults";
import { getApp } from "../../lib/state/app";
import { useSettingsStore } from "../../lib/state/hooks";
import { useGridMetrics } from "../../lib/state/useGridMetrics";
import { checkContrast, deriveColors } from "../../lib/theme/derive";
import { serializeTheme, themeFileName, type ThemeDoc, type ThemeRole } from "../../lib/theme/schema";
import { Button, Segmented, Slider, TextField } from "../../lib/ui/controls";
import { Icon } from "../../lib/ui/Icon";
import { ColorField } from "./ColorField";
import { downloadText } from "./download";
import { ThemePreview } from "./ThemePreview";
import { offerUndo } from "./undo";

interface RoleGroup {
  readonly title: string;
  readonly roles: readonly { readonly role: ThemeRole; readonly label: string; readonly alpha?: boolean }[];
}

const GROUPS: readonly RoleGroup[] = [
  {
    title: "Surfaces",
    roles: [
      { role: "bg", label: "Background" },
      { role: "surface", label: "Card", alpha: true },
      { role: "surface2", label: "Raised card" },
      { role: "border", label: "Outline", alpha: true },
    ],
  },
  {
    title: "Text",
    roles: [
      { role: "text", label: "Text" },
      { role: "textDim", label: "Secondary text" },
    ],
  },
  {
    title: "Accent",
    roles: [
      { role: "accent", label: "Accent" },
      { role: "accentInk", label: "Text on accent" },
      { role: "dotOn", label: "Lit dots" },
      { role: "dotOff", label: "Unlit dots", alpha: true },
    ],
  },
  {
    title: "Status",
    roles: [
      { role: "danger", label: "Warning" },
      { role: "success", label: "Good" },
    ],
  },
];

const SHADOW_PERCENT = 100;

/** Name box that only commits non-empty names, so the field can be cleared and retyped freely. */
function NameField({ theme, onCommit }: { readonly theme: ThemeDoc; readonly onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(theme.name);
  useEffect(() => setDraft(theme.name), [theme.id, theme.name]);
  const commit = (): void => {
    const next = draft.trim();
    if (next === "") setDraft(theme.name);
    else if (next !== theme.name) onCommit(next);
  };
  return (
    <TextField label="Theme name" value={draft} maxLength={LIMITS.themeNameLength} onChange={setDraft} onCommit={commit} invalid={draft.trim() === ""} />
  );
}

export interface ThemeEditorProps {
  readonly themeId: string;
  readonly onClose: () => void;
}

/** Full theme editor: every colour role, derive-from-accent, contrast checks and a live preview. */
export function ThemeEditor({ themeId, onClose }: ThemeEditorProps) {
  const app = getApp();
  const metrics = useGridMetrics();
  const theme = useSettingsStore((s) => s.customThemes.find((t) => t.id === themeId));
  if (!theme) return null;

  const save = (patch: Partial<ThemeDoc>): void => app.settings.getState().saveTheme({ ...theme, ...patch });
  const setRole = (role: ThemeRole, value: string): void => save({ colors: { ...theme.colors, [role]: value } });
  const contrast = checkContrast(theme.colors);

  const generate = (): void => {
    const before = theme;
    const palette = deriveColors(theme.colors.accent, theme.mode);
    if (!palette) return;
    save({ colors: palette });
    offerUndo("Palette rebuilt from the accent.", () => app.settings.getState().saveTheme(before));
  };

  const useTheme = (): void => {
    app.settings.getState().update((s) => {
      if (s.theme.mode === "fixed") return { ...s, theme: { ...s.theme, fixedId: theme.id } };
      return { ...s, theme: { ...s.theme, [theme.mode === "light" ? "lightId" : "darkId"]: theme.id } };
    });
  };

  const remove = (): void => {
    const before = theme;
    app.settings.getState().deleteTheme(theme.id);
    offerUndo(`${before.name} deleted.`, () => app.settings.getState().saveTheme(before));
    onClose();
  };

  return (
    <div className="editor" role="group" aria-label={`Editing ${theme.name}`}>
      <div className="editor__head">
        <div className="editor__title">
          <NameField theme={theme} onCommit={(name) => save({ name })} />
          <Segmented
            label="Theme is"
            value={theme.mode}
            options={[
              { value: "dark", label: "Dark", icon: "moon" },
              { value: "light", label: "Light", icon: "sun" },
            ]}
            onChange={(mode) => save({ mode })}
          />
        </div>
        <Button variant="ghost" icon="close" onClick={onClose}>
          Done
        </Button>
      </div>

      <div className="editor__body">
        <div className="editor__colors">
          <div className="editor__generate">
            <div>
              <div className="row__label">Start from one colour</div>
              <p className="row__desc">Pick the accent, then rebuild the whole palette around it. Surfaces take on its hue, faintly, and text stays readable.</p>
            </div>
            <Button icon="appearance" onClick={generate}>
              Build palette
            </Button>
          </div>
          {GROUPS.map((group) => (
            <fieldset key={group.title} className="editor__group">
              <legend className="caps">{group.title}</legend>
              {group.roles.map(({ role, label, alpha }) => (
                <ColorField key={role} label={label} value={theme.colors[role]} alpha={alpha === true} onChange={(value) => setRole(role, value)} />
              ))}
            </fieldset>
          ))}
          <div className="color-field">
            <span className="color-field__label">Card shadow</span>
            <span className="color-field__alpha">
              <Slider
                label="Card shadow strength"
                min={0}
                max={SHADOW_PERCENT}
                step={5}
                value={Math.round(theme.shadowStrength * SHADOW_PERCENT)}
                valueText={`${Math.round(theme.shadowStrength * SHADOW_PERCENT)} percent`}
                onChange={(percent) => save({ shadowStrength: percent / SHADOW_PERCENT })}
              />
              <span className="control-value tabular">{Math.round(theme.shadowStrength * SHADOW_PERCENT)}%</span>
            </span>
          </div>
        </div>

        <div className="editor__side">
          <ThemePreview theme={theme} metrics={metrics} />
          <ul className="contrast" aria-label="Contrast checks">
            {contrast.map((check) => (
              <li key={check.label} className={`contrast__row${check.pass ? "" : " is-fail"}`}>
                <Icon name={check.pass ? "check" : "warning"} size={14} />
                <span className="contrast__label">{check.label}</span>
                <span className="contrast__ratio tabular">{check.ratio.toFixed(1)}:1</span>
              </li>
            ))}
          </ul>
          <div className="editor__actions">
            <Button variant="primary" icon="check" onClick={useTheme}>
              Use this theme
            </Button>
            <Button icon="download" onClick={() => downloadText(themeFileName(theme), serializeTheme(theme))}>
              Export
            </Button>
            <Button variant="danger" icon="trash" onClick={remove}>
              Delete
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
