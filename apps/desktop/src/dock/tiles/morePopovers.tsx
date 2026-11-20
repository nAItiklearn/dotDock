import { useState } from "react";
import { Icon } from "../../design-system/Icon";
import { CITIES } from "../../widgets/data/cities";
import { actions } from "../bridge";
import { useDockStore } from "../store";
import { t } from "../strings";
import { runTileCommand, tilesBackend } from "./backend";
import { convertMoney, currencies, currencyName, formatMoney } from "./currency";
import { useFeed } from "./feeds";
import { useTicker } from "./hooks";
import { readFeed } from "./hub";
import { clockText } from "./memo";
import { deleteMemo, playMemo, startMemo, stopMemo, useMemos } from "./memoRecorder";
import { SunArc, useSunCity, Waveform } from "./moreFaces";
import { agoParts } from "./recent";
import { ENGINE_NAME, ENGINES, isAddressQuery, searchTarget } from "./search";
import { issueText } from "./shell";
import { arcFraction, deviceTimeZone, homeCity, sunDay } from "./sun";
import { copyText, Empty, useFlash } from "./toolsPopovers";
import { useTools } from "./toolsStore";
import { formatNumber, parseAmount } from "./units";

const SECOND_MS = 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const hourMinute = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const dateTime = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Sun --------------------------------------------------------------------------------------------------------------

/** "13 h 42 min": how long the sun is up. */
function lengthText(ms: number): string {
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.round((ms - hours * HOUR_MS) / MINUTE_MS);
  return t("tile.sun.length", { hours, minutes });
}

export function SunBody() {
  const city = useSunCity();
  const chosen = useTools((s) => s.sunCity);
  const { setSunCity } = useTools.getState();
  const now = useTicker(MINUTE_MS, true);
  const home = homeCity(deviceTimeZone());
  const day = city ? sunDay(now, city.lat, city.lon) : null;
  return (
    <div className="tp-body">
      {city && day ? (
        <>
          <div className="tp-sun">
            <SunArc fraction={arcFraction(now, day)} />
          </div>
          {day.kind === "day" ? (
            <dl className="tp-facts">
              <div>
                <dt className="caps">{t("tile.sun.rise")}</dt>
                <dd>{hourMinute.format(day.sunrise)}</dd>
              </div>
              <div>
                <dt className="caps">{t("tile.sun.set")}</dt>
                <dd>{hourMinute.format(day.sunset)}</dd>
              </div>
              <div>
                <dt className="caps">{t("tile.sun.daylight")}</dt>
                <dd>{lengthText(day.sunset - day.sunrise)}</dd>
              </div>
            </dl>
          ) : (
            <p className="tp-hint">{t(day.kind === "night" ? "tile.sun.night" : "tile.sun.allday")}</p>
          )}
        </>
      ) : (
        <Empty title={t("tile.sun.pick")} hint={t("tile.sun.pick.hint")} />
      )}
      <label className="tp-field">
        <span className="caps">{t("tile.sun.place")}</span>
        <select className="tp-input" value={chosen ?? ""} onChange={(e) => setSunCity(e.target.value === "" ? null : e.target.value)}>
          <option value="">{home ? t("tile.sun.here", { city: home.name }) : t("tile.sun.here.none")}</option>
          {CITIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// Web search -------------------------------------------------------------------------------------------------------

export function SearchBody() {
  const engine = useTools((s) => s.engine);
  const { setEngine } = useTools.getState();
  const [query, setQuery] = useState("");
  const target = searchTarget(engine, query);
  const go = async (): Promise<void> => {
    if (target === null) return;
    if (await runTileCommand(tilesBackend().commands.openUrl(target))) {
      setQuery("");
      useDockStore.getState().showTile(null);
    }
  };
  return (
    <div className="tp-body">
      <form
        className="tp-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <Icon name="search" />
        <input className="tp-input" autoFocus value={query} placeholder={t("tile.search.placeholder", { engine: ENGINE_NAME[engine] })} aria-label={t("tile.search")} onChange={(e) => setQuery(e.target.value)} />
      </form>
      <p className="tp-hint">{target === null ? t("tile.search.hint") : isAddressQuery(query) ? t("tile.search.opens", { address: target }) : t("tile.search.enter", { engine: ENGINE_NAME[engine] })}</p>
      <div className="tp-tabs" role="radiogroup" aria-label={t("tile.search.engine")}>
        {ENGINES.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={e === engine} onClick={() => setEngine(e)}>
            {ENGINE_NAME[e]}
          </button>
        ))}
      </div>
    </div>
  );
}

// History ----------------------------------------------------------------------------------------------------------

export function HistoryBody() {
  const recent = useTools((s) => s.recent);
  const apps = useDockStore((s) => s.apps);
  const { clearRecent } = useTools.getState();
  const now = useTicker(MINUTE_MS, true);
  const rows = recent.flatMap((r) => {
    const app = apps.find((a) => a.id === r.appId);
    return app ? [{ app, at: r.at }] : [];
  });
  if (rows.length === 0) return <Empty title={t("tile.history.none")} hint={t("tile.history.none.hint")} />;
  return (
    <div className="tp-body">
      <ul className="tp-list tp-scroll">
        {rows.map(({ app, at }) => {
          const ago = agoParts(at, now);
          return (
            <li key={app.id}>
              <button type="button" className="tp-recent" onClick={() => void actions.open(app)}>
                {app.icon ? <img src={app.icon} alt="" draggable={false} /> : <i aria-hidden="true">{app.name.charAt(0)}</i>}
                <span>{app.name}</span>
                <span className="tp-hint">{t(`tile.history.ago.${ago.unit}`, { count: ago.count })}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="tp-text-button" onClick={clearRecent}>
        {t("tile.history.clear")}
      </button>
    </div>
  );
}

// Voice memo -------------------------------------------------------------------------------------------------------

export function MemoBody() {
  const status = useMemos((s) => s.status);
  const levels = useMemos((s) => s.levels);
  const startedAt = useMemos((s) => s.startedAt);
  const memos = useMemos((s) => s.memos);
  const playing = useMemos((s) => s.playing);
  const issue = useMemos((s) => s.issue);
  const recording = status === "recording";
  const now = useTicker(SECOND_MS, recording);
  if (issue === "unsupported") return <Empty title={issueText(issue)} hint={t("tile.memo.unsupported.hint")} />;
  return (
    <div className="tp-body">
      <div className="tp-memo" data-recording={recording ? "true" : undefined}>
        <Waveform levels={recording ? levels.slice(-48) : []} className="wave-bars--live" />
        <span className="tp-memo__time">{recording && startedAt !== null ? clockText(now - startedAt) : clockText(0)}</span>
        <button
          type="button"
          className="tp-record"
          aria-pressed={recording}
          aria-label={recording ? t("tile.memo.stop") : t("tile.memo.record")}
          disabled={status === "starting"}
          onClick={() => void (recording ? stopMemo() : startMemo())}
        >
          <Icon name={recording ? "stop" : "mic"} />
        </button>
      </div>
      {issue === "no-device" ? <p className="tp-hint" role="status">{t("tile.memo.nomic")}</p> : null}
      {issue === "error" ? <p className="tp-hint" role="status">{issueText(issue)}</p> : null}
      {memos.length === 0 ? (
        <p className="tp-hint">{t("tile.memo.none")}</p>
      ) : (
        <ul className="tp-list tp-scroll">
          {memos.map((m) => (
            <li key={m.id} className="tp-memo-row">
              <button type="button" className="tp-icon" aria-label={playing === m.id ? t("tile.memo.pause") : t("tile.memo.play", { when: dateTime.format(m.createdAt) })} onClick={() => void playMemo(m.id)}>
                <Icon name={playing === m.id ? "pause" : "play"} />
              </button>
              <Waveform levels={m.peaks} className="wave-bars--saved" />
              <span className="tp-memo-row__meta">
                <b>{clockText(m.durationMs)}</b>
                <span className="tp-hint">{dateTime.format(m.createdAt)}</span>
              </span>
              <button type="button" className="tp-icon" aria-label={t("tile.memo.delete", { when: dateTime.format(m.createdAt) })} onClick={() => void deleteMemo(m.id)}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Currency ---------------------------------------------------------------------------------------------------------

export function CurrencyBody() {
  const read = readFeed(useFeed("rates"));
  const setup = useTools((s) => s.currency);
  const { setCurrency } = useTools.getState();
  const [flash, show] = useFlash();
  if (read.state !== "ready") return read.state === "issue" ? <Empty title={issueText(read.issue)} hint={t(`tile.issue.${read.issue}.hint`)} /> : <Empty title={t("tile.currency")} />;
  const rates = read.data;
  const codes = currencies(rates);
  const amount = parseAmount(setup.amount);
  const result = amount === null ? null : convertMoney(rates, setup.from, setup.to, amount);
  const select = (value: string, onChange: (code: string) => void, label: string) => (
    <label className="tp-field">
      <span className="caps">{label}</span>
      <select className="tp-input" value={codes.includes(value) ? value : rates.base} onChange={(e) => onChange(e.target.value)}>
        {codes.map((c) => (
          <option key={c} value={c}>
            {c} · {currencyName(c)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="tp-body">
      <label className="tp-field">
        <span className="caps">{t("tile.convert.amount")}</span>
        <input className="tp-input" inputMode="decimal" value={setup.amount} aria-invalid={amount === null} onChange={(e) => setCurrency({ amount: e.target.value })} />
      </label>
      <div className="tp-units">
        {select(setup.from, (from) => setCurrency({ from }), t("tile.convert.from"))}
        <button type="button" className="tp-icon" aria-label={t("tile.currency.swap")} title={t("tile.currency.swap")} onClick={() => setCurrency({ from: setup.to, to: setup.from })}>
          <Icon name="swap" />
        </button>
        {select(setup.to, (to) => setCurrency({ to }), t("tile.convert.to"))}
      </div>
      <div className="tp-result">
        <b className="tp-big">{result === null ? t("tile.convert.invalid") : formatMoney(result, setup.to)}</b>
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
        {flash ?? t("tile.currency.source", { date: dayMonth.format(rates.publishedAt) })}
      </p>
    </div>
  );
}
