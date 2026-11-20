import { create } from "zustand";
import { parseHistory, remember } from "./colour";
import { parseRecent, pushRecent } from "./emoji";
import { DEFAULT_PAIR, UNIT_CATEGORIES, unitIn, type UnitCategory } from "./units";
import { addCity, parseCities, removeCity, WORLD_KEY } from "./world";

/** What the small tools keep between runs: the colours picked, the emoji used, the conversion set up, the cities chosen. */
const COLOUR_KEY = "dotdock.dock.colours";
const EMOJI_KEY = "dotdock.dock.emoji";
const CONVERT_KEY = "dotdock.dock.convert";

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
