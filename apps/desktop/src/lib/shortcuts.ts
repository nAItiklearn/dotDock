/**
 * Keyboard shortcuts as canonical strings: "Ctrl+Alt+E", "Ctrl+Shift+Left", "Win+F5".
 * The same strings go to the core for global registration and to the overlay for local handling.
 */
export interface Chord {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  /** Windows key. */
  readonly meta: boolean;
  readonly key: string;
}

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Win"] as const;

const PUNCTUATION_BY_CODE: Readonly<Record<string, string>> = {
  Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`",
};
const PUNCTUATION = new Set(Object.values(PUNCTUATION_BY_CODE));

const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: "Escape", escape: "Escape", del: "Delete", delete: "Delete", ins: "Insert", insert: "Insert",
  return: "Enter", enter: "Enter", space: "Space", spacebar: "Space", tab: "Tab", backspace: "Backspace",
  home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
  up: "Up", arrowup: "Up", down: "Down", arrowdown: "Down", left: "Left", arrowleft: "Left", right: "Right", arrowright: "Right",
};

const MODIFIER_ALIASES: Readonly<Record<string, (typeof MODIFIER_ORDER)[number]>> = {
  ctrl: "Ctrl", control: "Ctrl", alt: "Alt", option: "Alt", shift: "Shift", win: "Win", meta: "Win", super: "Win", cmd: "Win",
};

function normalizeKey(raw: string): string | null {
  const alias = KEY_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  if (/^[a-z]$/i.test(raw)) return raw.toUpperCase();
  if (/^[0-9]$/.test(raw)) return raw;
  if (/^f([1-9]|1\d|2[0-4])$/i.test(raw)) return raw.toUpperCase();
  if (PUNCTUATION.has(raw)) return raw;
  return null;
}

export function parseShortcut(text: string): Chord | null {
  const split = text.lastIndexOf("+");
  const keyText = (split >= 0 ? text.slice(split + 1) : text).trim();
  const modifiers = split >= 0 ? text.slice(0, split).split("+") : [];
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  for (const part of modifiers) {
    const mod = MODIFIER_ALIASES[part.trim().toLowerCase()];
    if (!mod) return null;
    if (mod === "Ctrl") ctrl = true;
    else if (mod === "Alt") alt = true;
    else if (mod === "Shift") shift = true;
    else meta = true;
  }
  const key = normalizeKey(keyText);
  if (key === null) return null;
  return { ctrl, alt, shift, meta, key };
}

export function formatShortcut(chord: Chord): string {
  const flags = [chord.ctrl, chord.alt, chord.shift, chord.meta];
  const mods = MODIFIER_ORDER.filter((_, i) => flags[i]);
  return [...mods, chord.key].join("+");
}

/** Canonical form of a user-written shortcut, or null when it does not parse. */
export function normalizeShortcut(text: string): string | null {
  const chord = parseShortcut(text);
  return chord ? formatShortcut(chord) : null;
}

export interface KeyEventLike {
  readonly code: string;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

function keyFromEvent(e: KeyEventLike): string | null {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  const punctuation = PUNCTUATION_BY_CODE[e.code];
  if (punctuation) return punctuation;
  if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) return e.code;
  const arrow = /^Arrow(Up|Down|Left|Right)$/.exec(e.code);
  if (arrow?.[1]) return arrow[1];
  const named = KEY_ALIASES[e.code.toLowerCase()];
  if (named) return named;
  return normalizeKey(e.key);
}

/** The chord a key event represents, or null while only modifiers are held. */
export function chordFromEvent(e: KeyEventLike): Chord | null {
  const key = keyFromEvent(e);
  if (key === null) return null;
  return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key };
}

export function shortcutFromEvent(e: KeyEventLike): string | null {
  const chord = chordFromEvent(e);
  return chord ? formatShortcut(chord) : null;
}

export function eventMatches(e: KeyEventLike, shortcut: string): boolean {
  const chord = chordFromEvent(e);
  return chord !== null && formatShortcut(chord) === shortcut;
}

/** Combinations Windows or nearly every app already owns. Registering them would steal basic behaviour. */
const RESERVED = new Set([
  "Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+Z", "Ctrl+Y", "Ctrl+A", "Ctrl+S", "Ctrl+P", "Ctrl+W", "Ctrl+F",
  "Alt+F4", "Alt+Tab", "Ctrl+Escape", "Ctrl+Alt+Delete", "Ctrl+Shift+Escape", "Win+L", "Win+D", "Win+E", "Win+R", "Win+Tab",
]);

export type ShortcutIssue = "invalid" | "needs-modifier" | "reserved";

/** Why a shortcut cannot be a global hotkey, or null when it is acceptable. */
export function globalShortcutIssue(text: string): ShortcutIssue | null {
  const chord = parseShortcut(text);
  if (chord === null) return "invalid";
  const isFunctionKey = /^F\d+$/.test(chord.key);
  if (!chord.ctrl && !chord.alt && !chord.meta && !isFunctionKey) return "needs-modifier";
  return RESERVED.has(formatShortcut(chord)) ? "reserved" : null;
}

/** Actions that share a binding. Empty when every shortcut is unique. */
export function findConflicts<A extends string>(bindings: Readonly<Record<A, string>>): ReadonlyMap<A, readonly A[]> {
  const byShortcut = new Map<string, A[]>();
  for (const action of Object.keys(bindings) as A[]) {
    const list = byShortcut.get(bindings[action]) ?? [];
    list.push(action);
    byShortcut.set(bindings[action], list);
  }
  const conflicts = new Map<A, readonly A[]>();
  for (const actions of byShortcut.values()) {
    if (actions.length < 2) continue;
    for (const a of actions) conflicts.set(a, actions.filter((other) => other !== a));
  }
  return conflicts;
}
