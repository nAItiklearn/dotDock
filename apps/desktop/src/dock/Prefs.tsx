import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import { Icon } from "../design-system/Icon";
import { actions } from "./bridge";
import { clampIconSize, clampMagnification, ICON_LIMITS, MAGNIFICATION_LIMITS, placeBesideDock, PREFS, type Rect } from "./geometry";
import { markOpenPainted } from "./openMarks";
import { DEFAULT_SETTINGS, useDockStore } from "./store";
import { t } from "./strings";
import { DEFAULT_THEME, DOCK_THEMES, type DockThemeId } from "./theme";
import { useViewport } from "./useViewport";
import "./panels.css";
import "./tiles/popovers.css";
import "./prefs.css";

const SIZE_STEP = 2;
const MAGNIFICATION_STEP = 0.05;
const FACTOR_DIGITS = 2;

function Switch({ checked, label, onChange }: { readonly checked: boolean; readonly label: string; readonly onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" className="prefs__switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <i aria-hidden="true" />
    </button>
  );
}

/**
 * What Reset puts back: the items, tiles, size, magnification, hiding and look the dock starts with. Whether
 * the dock runs and whether it replaces the taskbar are left as they are; those are not part of how the dock looks.
 */
export function resetPatch(current: { readonly enabled: boolean; readonly replaceTaskbar: boolean }) {
  return { ...DEFAULT_SETTINGS, enabled: current.enabled, replaceTaskbar: current.replaceTaskbar };
}

/** Shown beside "Glass" when the dock is drawing something else in its place. */
export const drawnAsHint = (choice: DockThemeId, drawn: DockThemeId): string | null =>
  choice === drawn ? null : t("prefs.theme.drawnAs", { theme: t(`prefs.theme.${drawn}`) });

/**
 * The dock's settings, in a small popover beside the dock. Every control writes the real setting, so the dock behind
 * it changes as the control moves and that is the preview. Esc or a click away closes it.
 */
export function Prefs({ from, drawn }: { readonly from: Rect; /** The theme the dock is drawing now, which differs from the choice when glass has to step down. */ readonly drawn: DockThemeId }) {
  const settings = useDockStore((s) => s.settings);
  const choice = useDockStore((s) => s.themeChoice);
  const viewport = useViewport();
  const pos = placeBesideDock(from, { w: PREFS.w, h: PREFS.h }, viewport, PREFS.gapToDock);
  const size = Math.round(clampIconSize(settings.iconSize));
  const factor = clampMagnification(settings.magnification);
  const hint = drawnAsHint(choice, drawn);
  const [resetStep, setResetStep] = useState<"idle" | "confirm" | "done">("idle");
  const store = useDockStore.getState;
  const reset = (): void => {
    if (resetStep !== "confirm") {
      setResetStep("confirm");
      return;
    }
    void actions.updateSettings(resetPatch(store().settings));
    store().setThemeChoice(DEFAULT_THEME);
    setResetStep("done");
  };

  useLayoutEffect(() => {
    markOpenPainted("prefs");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || useDockStore.getState().menu !== null) return;
      e.preventDefault();
      useDockStore.getState().showPrefs(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const style = {
    transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
    width: PREFS.w,
    height: PREFS.h,
    "--tone": "var(--accent)",
    "--pop-pad": `${PREFS.pad}px`,
    "--pop-head": `${PREFS.head}px`,
  } as CSSProperties;

  return (
    <div className="popover prefs" role="dialog" aria-label={t("prefs.title")} style={style} data-open="true">
      <div className="popover__plate" />
      <div className="popover__content">
        <header className="popover__head">
          <i className="popover__dot" />
          <h2 className="popover__title">{t("prefs.title")}</h2>
          <button type="button" className="tp-icon prefs__close" aria-label={t("prefs.close")} onClick={() => useDockStore.getState().showPrefs(null)}>
            <Icon name="cross" />
          </button>
        </header>

        <div className="prefs__scroll">
        <section className="prefs__group">
          <h3 className="caps">{t("prefs.items")}</h3>
          <div className="prefs__actions">
            <button type="button" onClick={() => store().setLibrary(true)}>
              <Icon name="plus" />
              {t("prefs.items.app")}
            </button>
            <button type="button" onClick={() => store().showGallery({ from })}>
              <Icon name="plus" />
              {t("prefs.items.widget")}
            </button>
            <button
              type="button"
              onClick={() => {
                store().showPrefs(null);
                store().setEditing(true);
              }}
            >
              <Icon name="move" />
              {t("prefs.items.arrange")}
            </button>
          </div>
          <p className="tp-hint">{t("prefs.items.hint")}</p>
        </section>

        <section className="prefs__group">
          <label className="prefs__row">
            <span className="caps">{t("prefs.size")}</span>
            <b>{t("prefs.size.value", { size })}</b>
            <input
              type="range"
              min={ICON_LIMITS.min}
              max={ICON_LIMITS.max}
              step={SIZE_STEP}
              value={size}
              aria-label={t("prefs.size")}
              onChange={(e) => void actions.updateSettings({ iconSize: Number(e.target.value) })}
            />
          </label>
          <label className="prefs__row">
            <span className="caps">{t("prefs.magnification")}</span>
            <b>{factor <= MAGNIFICATION_LIMITS.min ? t("prefs.magnification.off") : t("prefs.magnification.value", { factor: factor.toFixed(FACTOR_DIGITS) })}</b>
            <input
              type="range"
              min={MAGNIFICATION_LIMITS.min}
              max={MAGNIFICATION_LIMITS.max}
              step={MAGNIFICATION_STEP}
              value={factor}
              aria-label={t("prefs.magnification")}
              onChange={(e) => void actions.updateSettings({ magnification: Number(e.target.value) })}
            />
          </label>
        </section>

        <section className="prefs__group">
          <Switch checked={settings.autoHide} label={t("prefs.autoHide")} onChange={(autoHide) => void actions.updateSettings({ autoHide })} />
          <Switch checked={settings.reserveSpace} label={t("prefs.reserve")} onChange={(reserveSpace) => void actions.updateSettings({ reserveSpace })} />
        </section>

        <section className="prefs__group">
          <h3 className="caps">{t("prefs.theme")}</h3>
          <div className="prefs__chips" role="radiogroup" aria-label={t("prefs.theme")}>
            {DOCK_THEMES.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={choice === id} onClick={() => useDockStore.getState().setThemeChoice(id)}>
                {t(`prefs.theme.${id}`)}
              </button>
            ))}
          </div>
          {hint ? <p className="tp-hint" role="status">{hint}</p> : null}
        </section>

        <section className="prefs__group">
          <button type="button" className="prefs__reset" data-confirm={resetStep === "confirm" ? "true" : undefined} onClick={reset}>
            {resetStep === "confirm" ? t("prefs.reset.confirm") : t("prefs.reset")}
          </button>
          {resetStep === "done" ? (
            <p className="tp-hint" role="status">
              {t("prefs.reset.done")}
            </p>
          ) : null}
        </section>
        </div>
      </div>
    </div>
  );
}
