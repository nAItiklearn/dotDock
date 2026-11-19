/** Pure operations for the notes widget. */
export type NoteColor = "plain" | "accent" | "ink" | "moss" | "stone";

export const NOTE_COLORS: readonly NoteColor[] = ["plain", "accent", "ink", "moss", "stone"];

export interface Note {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly color: NoteColor;
  readonly pinned: boolean;
}

export const MAX_NOTES = 30;
export const MAX_TITLE_LENGTH = 60;
export const MAX_BODY_LENGTH = 4000;

export function createNote(id: string, color: NoteColor = "plain"): Note {
  return { id, title: "", body: "", color, pinned: false };
}

/** Pinned notes first; otherwise the order they were made in, so the pager never shuffles while typing. */
export function orderedNotes(notes: readonly Note[]): readonly Note[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function nextColor(color: NoteColor): NoteColor {
  const index = NOTE_COLORS.indexOf(color);
  return NOTE_COLORS[(index + 1) % NOTE_COLORS.length] ?? "plain";
}

/** Text typed by the user, trimmed to the limits. Whitespace inside is kept. */
export function clampNoteText(title: string, body: string): { title: string; body: string } {
  return { title: title.slice(0, MAX_TITLE_LENGTH), body: body.slice(0, MAX_BODY_LENGTH) };
}

const BULLET = "- ";

/**
 * Makes Enter continue a bullet list. On a line that starts with "- " it starts the next bullet;
 * on an empty bullet it ends the list. Returns null when the line is not a bullet.
 */
export function continueList(value: string, caret: number): { value: string; caret: number } | null {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const line = value.slice(lineStart, caret);
  if (!line.startsWith(BULLET)) return null;
  if (line === BULLET) {
    // An empty bullet: remove it and leave the list.
    return { value: value.slice(0, lineStart) + value.slice(caret), caret: lineStart };
  }
  const insert = `\n${BULLET}`;
  return { value: value.slice(0, caret) + insert + value.slice(caret), caret: caret + insert.length };
}
