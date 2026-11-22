import { useState, type ReactNode } from "react";
import { Icon } from "../../design-system/Icon";
import { orderedNotes } from "../../widgets/notesModel";
import { useNotesStore } from "../../widgets/notesStore";
import { t } from "../strings";
import { runTileCommand, tilesBackend } from "./backend";
import { inkFor, normaliseHex, rgbText } from "./colour";
import { EMOJI_GROUPS, emojiOf, type EmojiGroup } from "./emoji";
import { useFeed } from "./feeds";
import { readFeed } from "./hub";
import { DotGraph } from "./Graphs";
import { useTicker } from "./hooks";
import { formatRate, rateLevels, scaleOf } from "./network";
import { useNetworkHistory } from "./networkHistory";
import { issueText } from "./shell";
import { FACE_TOGGLES, toggle, TOGGLE_ICON } from "./toolsFaces";
import { useTools } from "./toolsStore";
import type { ToggleName } from "./ui-types";
import { CATEGORIES, convert, formatNumber, parseAmount, unitName, unitSymbol, UNIT_CATEGORIES } from "./units";
import { cityChoices, MAX_CITIES, worldRows } from "./world";

const SECOND_MS = 1000;
const GRAPH_COLS = 30;
const GRAPH_ROWS = 8;
const CITY_RESULTS = 8;
const COPIED_MS = 1600;
const BRIGHTNESS_STEP = 0.01;

export function Empty({ title, hint }: { readonly title: string; readonly hint?: string }) {
  return (
    <div className="tp-empty">
      <p>{title}</p>
      {hint ? <p className="tp-hint">{hint}</p> : null}
    </div>
  );
}

/** Puts text on the clipboard; false when the page may not (no focus, no permission). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Shows `message` for a moment, then clears it: the small "Copied" under a control. */
export function useFlash(): readonly [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  return [
    message,
    (next) => {
      setMessage(next);
      window.setTimeout(() => setMessage(null), COPIED_MS);
    },
  ];
}

// Notes ------------------------------------------------------------------------------------------------------------

export function NotesBody() {
  const notes = useNotesStore((s) => s.notes);
  const activeId = useNotesStore((s) => s.activeId);
  const { add, select, edit, togglePin, remove } = useNotesStore.getState();
  const ordered = orderedNotes(notes);
  const active = ordered.find((n) => n.id === activeId) ?? ordered[0];
  const name = (n: { readonly title: string; readonly body: string }): string => n.title.trim() || n.body.trim().split("\n")[0] || t("tile.notes.untitled");
  return (
    <div className="tp-body">
      <div className="tp-tabs" role="tablist" aria-label={t("tile.notes")}>
        {ordered.map((n) => (
          <button key={n.id} type="button" role="tab" aria-selected={n.id === active?.id} onClick={() => select(n.id)}>
            {name(n)}
          </button>
        ))}
        <button type="button" className="tp-tabs__add" aria-label={t("tile.notes.new")} title={t("tile.notes.new")} onClick={add}>
          <Icon name="plus" />
        </button>
      </div>
      {active ? (
        <div className="tp-note">
          <input className="tp-input" value={active.title} placeholder={t("tile.notes.title")} aria-label={t("tile.notes.title")} onChange={(e) => edit(active.id, e.target.value, active.body)} />
          <textarea className="tp-input tp-note__body" value={active.body} placeholder={t("tile.notes.body")} aria-label={t("tile.notes.body")} onChange={(e) => edit(active.id, active.title, e.target.value)} />
          <div className="tp-actions">
            <button type="button" className="tp-btn" aria-pressed={active.pinned} aria-label={t(active.pinned ? "tile.notes.unpin" : "tile.notes.pin", { name: name(active) })} onClick={() => togglePin(active.id)}>
              <Icon name="pin" />
            </button>
            <button type="button" className="tp-btn" aria-label={t("tile.notes.delete", { name: name(active) })} onClick={() => remove(active.id)}>
              <Icon name="trash" />
            </button>
          </div>
        </div>
      ) : (
        <Empty title={t("tile.notes.none")} hint={t("tile.notes.none.hint")} />
      )}
    </div>
  );
}

// Colour picker ----------------------------------------------------------------------------------------------------

interface EyeDropperLike {
  open: () => Promise<{ readonly sRGBHex: string }>;
}

/** The browser's screen colour picker, where the window has one. */
export function eyeDropper(): (new () => EyeDropperLike) | null {
  const ctor = (window as unknown as { EyeDropper?: new () => EyeDropperLike }).EyeDropper;
  return ctor ?? null;
}

export function ColourBody() {
  const colours = useTools((s) => s.colours);
  const { pickColour } = useTools.getState();
  const [flash, show] = useFlash();
  const Dropper = eyeDropper();
  const copy = async (hex: string): Promise<void> => {
    if (await copyText(hex)) show(t("tile.colour.copied", { hex }));
  };
  const pick = async (): Promise<void> => {
    if (!Dropper) return;
    try {
      const hex = normaliseHex((await new Dropper().open()).sRGBHex);
      if (!hex) return;
      pickColour(hex);
      await copy(hex);
    } catch {
      // The picker was dismissed with Esc: nothing was chosen.
    }
  };
  const latest = colours[0];
  return (
    <div className="tp-body tp-center">
      {Dropper ? (
        <button type="button" className="tp-btn" data-primary="true" onClick={() => void pick()}>
          <Icon name="picker" />
          {t("tile.colour.pick")}
        </button>
      ) : (
        <Empty title={issueText("unsupported")} hint={t("tile.issue.unsupported.hint")} />
      )}
      {latest ? (
        <>
          <span className="tp-swatch" style={{ background: latest, color: inkFor(latest) }}>
            {latest}
          </span>
          <p className="tp-hint">{rgbText(latest)}</p>
          <h3 className="tp-heading caps">{t("tile.colour.recent")}</h3>
          <ul className="tp-swatches">
            {colours.map((hex) => (
              <li key={hex}>
                <button type="button" style={{ background: hex }} aria-label={t("tile.colour.copy", { hex })} title={hex} onClick={() => void copy(hex)} />
              </li>
            ))}
          </ul>
        </>
      ) : Dropper ? (
        <Empty title={t("tile.colour.none")} hint={t("tile.colour.none.hint")} />
      ) : null}
      <p className="tp-hint" role="status">
        {flash}
      </p>
    </div>
  );
}

// Converter --------------------------------------------------------------------------------------------------------

export function ConvertBody() {
  const setup = useTools((s) => s.conversion);
  const { setConversion } = useTools.getState();
  const [flash, show] = useFlash();
  const amount = parseAmount(setup.amount);
  const result = amount === null ? null : convert(setup.category, setup.from, setup.to, amount);
  return (
    <div className="tp-body tp-body--fit">
      <div className="tp-tabs" role="tablist" aria-label={t("tile.convert")}>
        {UNIT_CATEGORIES.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={c === setup.category} onClick={() => setConversion({ category: c })}>
            {t(`tile.convert.category.${c}`)}
          </button>
        ))}
      </div>
      <label className="tp-field">
        <span className="caps">{t("tile.convert.amount")}</span>
        <input className="tp-input" inputMode="decimal" value={setup.amount} aria-invalid={amount === null} onChange={(e) => setConversion({ amount: e.target.value })} />
      </label>
      <div className="tp-units">
        <label className="tp-field">
          <span className="caps">{t("tile.convert.from")}</span>
          <select className="tp-input" value={setup.from} onChange={(e) => setConversion({ from: e.target.value })}>
            {CATEGORIES[setup.category].map((u) => (
              <option key={u.id} value={u.id}>
                {unitName(u.id)} ({unitSymbol(u.id)})
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="tp-icon" aria-label={t("tile.convert.swap")} title={t("tile.convert.swap")} onClick={() => setConversion({ from: setup.to, to: setup.from })}>
          <Icon name="swap" />
        </button>
        <label className="tp-field">
          <span className="caps">{t("tile.convert.to")}</span>
          <select className="tp-input" value={setup.to} onChange={(e) => setConversion({ to: e.target.value })}>
            {CATEGORIES[setup.category].map((u) => (
              <option key={u.id} value={u.id}>
                {unitName(u.id)} ({unitSymbol(u.id)})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="tp-result">
        <b className="tp-big">{result === null ? t("tile.convert.invalid") : `${formatNumber(result)} ${unitSymbol(setup.to)}`}</b>
        <button
          type="button"
          className="tp-icon"
          aria-label={t("tile.convert.copy")}
          title={t("tile.convert.copy")}
          disabled={result === null}
          onClick={() => result !== null && void copyText(formatNumber(result)).then((ok) => ok && show(t("tile.convert.copied")))}
        >
          <Icon name="copy" />
        </button>
      </div>
      <p className="tp-hint" role="status">
        {flash}
      </p>
    </div>
  );
}

// Emoji ------------------------------------------------------------------------------------------------------------

export function EmojiBody() {
  const recent = useTools((s) => s.emoji);
  const { rememberEmoji } = useTools.getState();
  const [group, setGroup] = useState<EmojiGroup>("faces");
  const [flash, show] = useFlash();
  const choose = async (emoji: string): Promise<void> => {
    rememberEmoji(emoji);
    if (await copyText(emoji)) show(t("tile.emoji.copied"));
  };
  const button = (emoji: string) => (
    <button key={emoji} type="button" aria-label={t("tile.emoji.copy", { emoji })} onClick={() => void choose(emoji)}>
      {emoji}
    </button>
  );
  return (
    <div className="tp-body">
      {recent.length > 0 ? (
        <>
          <h3 className="tp-heading caps">{t("tile.emoji.recent")}</h3>
          <div className="tp-emoji tp-emoji--recent">{recent.map(button)}</div>
        </>
      ) : null}
      <div className="tp-tabs" role="tablist" aria-label={t("tile.emoji")}>
        {EMOJI_GROUPS.map((g) => (
          <button key={g} type="button" role="tab" aria-selected={g === group} onClick={() => setGroup(g)}>
            {t(`tile.emoji.group.${g}`)}
          </button>
        ))}
      </div>
      <div className="tp-emoji tp-scroll">{emojiOf(group).map(button)}</div>
      <p className="tp-hint" role="status">
        {flash}
      </p>
    </div>
  );
}

// World clock ------------------------------------------------------------------------------------------------------

const dayWords = (offset: number): string | null => (offset === 0 ? null : offset > 0 ? t("tile.world.tomorrow") : t("tile.world.yesterday"));

export function WorldBody() {
  const cities = useTools((s) => s.cities);
  const { chooseCity, dropCity } = useTools.getState();
  const now = useTicker(SECOND_MS * 30, true);
  const [query, setQuery] = useState("");
  const rows = worldRows(cities, new Date(now));
  const choices = cityChoices(cities, query).slice(0, CITY_RESULTS);
  const full = cities.length >= MAX_CITIES;
  return (
    <div className="tp-body">
      {rows.length === 0 ? (
        <Empty title={t("tile.world.none")} hint={t("tile.world.none.hint")} />
      ) : (
        <ul className="tp-list">
          {rows.map((row) => (
            <li key={row.city.id} className="tp-city">
              <span className="tp-city__name">
                <b>{row.city.name}</b>
                <span className="tp-hint">{[row.offset, dayWords(row.dayOffset)].filter((p) => p).join(" · ")}</span>
              </span>
              <b className="tp-value">{row.time}</b>
              <button type="button" className="tp-icon" aria-label={t("tile.world.remove", { city: row.city.name })} onClick={() => dropCity(row.city.id)}>
                <Icon name="cross" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="tp-hint" role="status">
          {t("tile.world.limit", { count: MAX_CITIES })}
        </p>
      ) : (
        <>
          <input className="tp-input" value={query} placeholder={t("tile.world.search")} aria-label={t("tile.world.search")} onChange={(e) => setQuery(e.target.value)} />
          {choices.length === 0 ? (
            <p className="tp-hint">{t("tile.world.nomatch", { query })}</p>
          ) : (
            <ul className="tp-list tp-scroll tp-choices">
              {choices.map((city) => (
                <li key={city.id}>
                  <button type="button" className="tp-device" aria-label={`${t("tile.world.add")}: ${city.name}`} onClick={() => chooseCity(city.id)}>
                    <Icon name="plus" />
                    {city.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// Network ----------------------------------------------------------------------------------------------------------

export function NetworkBody() {
  const read = readFeed(useFeed("network"));
  const samples = useNetworkHistory((s) => s.samples);
  const now = useTicker(SECOND_MS, true);
  if (read.state === "issue") return <Empty title={issueText(read.issue)} hint={t(`tile.issue.${read.issue}.hint`)} />;
  const scale = scaleOf(samples);
  const view = read.state === "ready" ? read.data : null;
  return (
    <div className="tp-body">
      {(["down", "up"] as const).map((direction) => (
        <section key={direction} className="tp-metric" aria-label={`${t(`tile.network.${direction}`)} ${view ? formatRate(direction === "down" ? view.downBytesPerSec : view.upBytesPerSec) : ""}`}>
          <header className="tp-row">
            <span className="caps">{t(`tile.network.${direction}`)}</span>
            <b className="tp-value">{view ? formatRate(direction === "down" ? view.downBytesPerSec : view.upBytesPerSec) : "–"}</b>
          </header>
          <DotGraph levels={rateLevels(samples, direction, scale, now, GRAPH_COLS, GRAPH_ROWS)} rows={GRAPH_ROWS} />
        </section>
      ))}
      <p className="tp-hint tp-center">{t("tile.system.window")}</p>
    </div>
  );
}

// Quick settings ---------------------------------------------------------------------------------------------------

const ALL_TOGGLES: readonly ToggleName[] = [...FACE_TOGGLES, "doNotDisturb"];

export function TogglesBody() {
  const read = readFeed(useFeed("toggles"));
  const [local, setLocal] = useState<number | null>(null);
  if (read.state === "issue") return <Empty title={issueText(read.issue)} hint={t(`tile.issue.${read.issue}.hint`)} />;
  if (read.state === "pending") return null;
  const view = read.data;
  const brightness = local ?? view.brightness;
  const send = (value: number): void => {
    setLocal(value);
    void runTileCommand(tilesBackend().commands.toggles({ type: "brightness", value }));
  };
  const rows: ReactNode[] = ALL_TOGGLES.map((name) => {
    const on = view.switches[name];
    return (
      <li key={name}>
        <button type="button" role="switch" className="tp-switchrow" aria-checked={on === true} disabled={on === null} onClick={() => toggle(name, on !== true)}>
          <Icon name={name === "doNotDisturb" ? "bell" : TOGGLE_ICON[name]} />
          <span>{t(`tile.toggles.${name}`)}</span>
          <small className="tp-hint">{on === null ? t("tile.toggles.missing") : ""}</small>
          <i aria-hidden="true" />
        </button>
      </li>
    );
  });
  return (
    <div className="tp-body">
      <ul className="tp-list">{rows}</ul>
      <section className="tp-metric">
        <header className="tp-row">
          <span className="caps">{t("tile.toggles.brightness")}</span>
          <b className="tp-value">{brightness === null ? t("tile.toggles.missing") : t("tile.audio.percent", { percent: Math.round(brightness * 100) })}</b>
        </header>
        <div className="tp-slider">
          <Icon name="sun" />
          <input
            type="range"
            min={0}
            max={1}
            step={BRIGHTNESS_STEP}
            value={brightness ?? 0}
            disabled={brightness === null}
            aria-label={t("tile.toggles.brightness")}
            onChange={(e) => send(Number(e.target.value))}
            onPointerUp={() => setLocal(null)}
            onBlur={() => setLocal(null)}
          />
        </div>
      </section>
    </div>
  );
}
