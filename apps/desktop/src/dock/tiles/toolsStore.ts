import { create } from "zustand";
import { parseHistory, remember } from "./colour";
import { parseRecent, pushRecent } from "./emoji";
import { DEFAULT_PAIR, UNIT_CATEGORIES, unitIn, type UnitCategory } from "./units";
import { addCity, parseCities, removeCity, WORLD_KEY } from "./world";
import { parseCurrency, type CurrencySetup } from "./currency";
import { parseRecentLaunches, pushLaunch, RECENT_KEY, type RecentLaunch } from "./recent";
import { DEFAULT_ENGINE, isEngine, type Engine } from "./search";

/** What the small tools keep between runs: the colours picked, the emoji used, the conversion set up, the cities chosen. */
const COLOUR_KEY = "dotdock.dock.colours";
const EMOJI_KEY = "dotdock.dock.emoji";
const CONVERT_KEY = "dotdock.dock.convert";
const CURRENCY_KEY = "dotdock.dock.currency";
const ENGINE_KEY = "dotdock.dock.searchEngine";
const SUN_KEY = "dotdock.dock.sunCity";

/** A stored JSON string, or null. */
function parseString(raw: string | null): string | null {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export interface ConversionSetup {
  readonly category: UnitCategory;
  readonly from: string;
  readonly to: string;
  /** What was typed, so "1,5" stays as typed. */
  readonly amount: string;
}

export const DEFAULT_CONVERSION: ConversionSetup = { category: "length", from: DEFAULT_PAIR.length[0], to: DEFAULT_PAIR.length[1], amount: "1" };

/** A saved conversion, repaired field by field: an unknown unit falls back to the category's pair. */
export function parseConversion(raw: string | null): ConversionSetup {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value === null || typeof value !== "object") return DEFAULT_CONVERSION;
    const { category, from, to, amount } = value as Record<string, unknown>;
    const known = UNIT_CATEGORIES.find((c) => c === category) ?? DEFAULT_CONVERSION.category;
    const has = (id: unknown): id is string => typeof id === "string" && unitIn(known, id).id === id;
    const [defaultFrom, defaultTo] = DEFAULT_PAIR[known];
    return { category: known, from: has(from) ? from : defaultFrom, to: has(to) ? to : defaultTo, amount: typeof amount === "string" ? amount.slice(0, 24) : DEFAULT_CONVERSION.amount };
  } catch {
    return DEFAULT_CONVERSION;
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the choice lasts until the window closes.
  }
}

interface ToolsStore {
  readonly colours: readonly string[];
  readonly emoji: readonly string[];
  readonly conversion: ConversionSetup;
  readonly cities: readonly string[];
  readonly currency: CurrencySetup;
  readonly engine: Engine;
  /** The city the sun arc follows; null follows the device's own time zone. */
  readonly sunCity: string | null;
  readonly recent: readonly RecentLaunch[];
  readonly setCurrency: (patch: Partial<CurrencySetup>) => void;
  readonly setEngine: (engine: Engine) => void;
  readonly setSunCity: (id: string | null) => void;
  readonly recordLaunch: (appId: string, at: number) => void;
  readonly clearRecent: () => void;
  readonly pickColour: (hex: string) => void;
  readonly rememberEmoji: (emoji: string) => void;
  readonly setConversion: (patch: Partial<ConversionSetup>) => void;
  readonly chooseCity: (id: string) => void;
  readonly dropCity: (id: string) => void;
}

export const useTools = create<ToolsStore>((set, get) => ({
  colours: parseHistory(read(COLOUR_KEY)),
  emoji: parseRecent(read(EMOJI_KEY)),
  conversion: parseConversion(read(CONVERT_KEY)),
  cities: parseCities(read(WORLD_KEY)),
  currency: parseCurrency(read(CURRENCY_KEY)),
  engine: ((): Engine => {
    const saved = parseString(read(ENGINE_KEY));
    return isEngine(saved) ? saved : DEFAULT_ENGINE;
  })(),
  sunCity: parseString(read(SUN_KEY)),
  recent: parseRecentLaunches(read(RECENT_KEY)),
  setCurrency: (patch) => {
    const currency = { ...get().currency, ...patch };
    write(CURRENCY_KEY, currency);
    set({ currency });
  },
  setEngine: (engine) => {
    write(ENGINE_KEY, engine);
    set({ engine });
  },
  setSunCity: (id) => {
    write(SUN_KEY, id);
    set({ sunCity: id });
  },
  recordLaunch: (appId, at) => {
    const recent = pushLaunch(get().recent, appId, at);
    write(RECENT_KEY, recent);
    set({ recent });
  },
  clearRecent: () => {
    write(RECENT_KEY, []);
    set({ recent: [] });
  },
  pickColour: (hex) => {
    const colours = remember(get().colours, hex);
    write(COLOUR_KEY, colours);
    set({ colours });
  },
  rememberEmoji: (emoji) => {
    const recent = pushRecent(get().emoji, emoji);
    write(EMOJI_KEY, recent);
    set({ emoji: recent });
  },
  setConversion: (patch) => {
    const next = { ...get().conversion, ...patch };
    // Changing the category restarts on that category's usual pair; changing only a unit keeps the other.
    const setup = patch.category !== undefined && patch.category !== get().conversion.category ? { ...next, from: DEFAULT_PAIR[patch.category][0], to: DEFAULT_PAIR[patch.category][1], ...patch } : next;
    write(CONVERT_KEY, setup);
    set({ conversion: setup });
  },
  chooseCity: (id) => {
    const cities = addCity(get().cities, id);
    write(WORLD_KEY, cities);
    set({ cities });
  },
  dropCity: (id) => {
    const cities = removeCity(get().cities, id);
    write(WORLD_KEY, cities);
    set({ cities });
  },
}));
