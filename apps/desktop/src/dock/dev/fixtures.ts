import type { Category, CategoryId, DockApp, DockSettings, DockSnapshot, DockWindow } from "../protocol";
import { sampleIcon } from "./sampleIcons";

/** DEV ONLY. Sample catalogue for designing the dock in a plain browser. Every name here is invented. */

export const CATEGORIES: readonly Category[] = [
  { id: "productivity", name: null, tone: "amber", order: 0 },
  { id: "communication", name: null, tone: "green", order: 1 },
  { id: "development", name: null, tone: "blue", order: 2 },
  { id: "ai", name: null, tone: "violet", order: 3 },
  { id: "creative", name: null, tone: "pink", order: 4 },
  { id: "browsers", name: null, tone: "teal", order: 5 },
  { id: "media", name: null, tone: "red", order: 6 },
  { id: "games", name: null, tone: "accent", order: 7 },
  { id: "utilities", name: null, tone: "neutral", order: 8 },
  { id: "system", name: null, tone: "neutral", order: 9 },
  { id: "other", name: null, tone: "neutral", order: 10 },
];

const DAY_MS = 24 * 60 * 60 * 1000;
export const SAMPLE_NOW = Date.UTC(2026, 10, 19, 17, 28);

const PUBLISHERS = ["Northwind Labs", "Contoso Works", "Fabrikam Software", "Tailspin Studio", "Adatum Tools", null] as const;

const NAMES: Readonly<Record<string, readonly string[]>> = {
  productivity: ["Paperwork", "Ledger Sheets", "Slide Studio", "Taskboard", "Day Planner", "Notebook"],
  communication: ["Harbor Mail", "Kite Chat", "Lumen Meet", "Signal Post", "Voice Room"],
  development: ["Forge Code", "Cobalt Terminal", "Branch Git", "Lattice DB", "Pixel Debug", "Package Hub", "Merge Desk"],
  ai: ["Orbit Assistant", "Prompt Pad", "Vector Lab"],
  creative: ["Prism Photo", "Sketch Loop", "Frame Cut", "Tone Studio", "Vector Pen"],
  browsers: ["Atlas Browser", "Quill Private", "Compass"],
  media: ["Wave Player", "Reel Movies", "Podcast Deck", "Camera Roll"],
  games: ["Arcade Hub", "Chess Club", "Block Quest"],
  utilities: ["Zip Box", "Disk Scout", "Clip Shelf", "Unit Calc", "Screen Snap"],
  system: ["System Panel", "Task Monitor", "Disk Doctor"],
  other: ["Odd Tool", "Legacy Viewer"],
};

export function makeApp(name: string, category: CategoryId, index: number, firstSeen = SAMPLE_NOW - 90 * DAY_MS): DockApp {
  return {
    id: `sample.${name.toLowerCase().replaceAll(" ", "-")}`,
    name,
    category,
    filedBy: index % 3 === 0 ? "known" : index % 3 === 1 ? "rule" : "store",
    icon: sampleIcon(name),
    publisher: PUBLISHERS[index % PUBLISHERS.length] ?? null,
    firstSeen,
  };
}

export const APPS: readonly DockApp[] = Object.entries(NAMES).flatMap(([category, names]) =>
  names.map((name, i) => makeApp(name, category as CategoryId, i)),
);

export const appId = (name: string): string => `sample.${name.toLowerCase().replaceAll(" ", "-")}`;

const win = (hwnd: number, name: string, title: string, extra: Partial<DockWindow> = {}): DockWindow => ({
  hwnd: String(hwnd),
  appId: appId(name),
  title,
  icon: sampleIcon(name),
  minimized: false,
  focused: false,
  flashing: false,
  ...extra,
});

export const WINDOWS: readonly DockWindow[] = [
  win(1001, "Forge Code", "dock.css - dotDock - Forge Code", { focused: true }),
  win(1002, "Forge Code", "magnify.ts - dotDock - Forge Code"),
  win(1101, "Atlas Browser", "Weather this week - Atlas Browser"),
  win(1102, "Atlas Browser", "Spring physics explained - Atlas Browser"),
  win(1103, "Atlas Browser", "Inbox (3) - Atlas Browser", { flashing: true }),
  win(1201, "Harbor Mail", "Inbox - Harbor Mail"),
  win(1301, "Wave Player", "Slow Afternoon - Wave Player", { minimized: true }),
  { hwnd: "1401", appId: null, title: "Scratch Terminal", icon: sampleIcon("Scratch Terminal"), minimized: false, focused: false, flashing: false },
];

export const SETTINGS: DockSettings = {
  schema: 1,
  enabled: true,
  replaceTaskbar: false,
  edge: "bottom",
  reserveSpace: true,
  autoHide: false,
  iconSize: 48,
  magnification: 1.7,
  pinned: [
    { kind: "app", id: appId("Atlas Browser") },
    { kind: "app", id: appId("Harbor Mail") },
    { kind: "app", id: appId("Forge Code") },
    { kind: "stack", category: "productivity" },
    { kind: "stack", category: "communication" },
    { kind: "stack", category: "development" },
    { kind: "stack", category: "creative" },
    { kind: "stack", category: "media" },
    { kind: "stack", category: "utilities" },
  ],
  tiles: ["clock", "media"],
};

export const SNAPSHOT: DockSnapshot = { categories: CATEGORIES, apps: APPS, windows: WINDOWS, settings: SETTINGS };
