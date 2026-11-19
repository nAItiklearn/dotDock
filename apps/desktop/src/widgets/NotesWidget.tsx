import { useEffect, useState, type KeyboardEvent } from "react";
import { DotIcon } from "../design-system/DotMatrix";
import { Caps, IconButton, Surface } from "../design-system/primitives";
import type { ConfigSchema } from "./configSchema";
import { defineWidget, type WidgetProps } from "./definition";
import { useNotesStore } from "./notesStore";
import { continueList, MAX_BODY_LENGTH, MAX_NOTES, MAX_TITLE_LENGTH, nextColor, orderedNotes, type Note } from "./notesModel";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import "./NotesWidget.css";

export type NoteTextSize = "small" | "regular" | "large";

export interface NotesConfig {
  readonly textSize: NoteTextSize;
}

const NOTES_SIZES: readonly SizeSpec[] = [
  { id: "m", name: "Note", w: 4, h: 2 },
  { id: "l", name: "Notebook", w: 4, h: 4 },
];

const NOTES_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    textSize: {
      type: "string",
      title: "Text size",
      default: "regular",
      oneOf: [
        { const: "small", title: "Small" },
        { const: "regular", title: "Regular" },
        { const: "large", title: "Large" },
      ],
    },
  },
};

const CONFIRM_MS = 2500;
const PAGER_LIMIT = 8;

/** Delete asks twice: the first press arms it for a moment, the second removes the note. */
function useArmed(): [string | null, (id: string | null) => void] {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  return [armed, setArmed];
}

function Editor({ note, size }: { readonly note: Note; readonly size: SizeId }) {
  const edit = useNotesStore((s) => s.edit);
  const onBodyKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const field = e.currentTarget;
    const next = continueList(field.value, field.selectionStart);
    if (!next) return;
    e.preventDefault();
    edit(note.id, note.title, next.value);
    requestAnimationFrame(() => field.setSelectionRange(next.caret, next.caret));
  };
  return (
    <div className="notes__editor">
      <input
        className="notes__title"
        name="note-title"
        value={note.title}
        maxLength={MAX_TITLE_LENGTH}
        placeholder="Title"
        aria-label="Note title"
        spellCheck={false}
        onChange={(e) => edit(note.id, e.target.value, note.body)}
      />
      <textarea
        className="notes__body"
        name="note-text"
        value={note.body}
        maxLength={MAX_BODY_LENGTH}
        placeholder={size === "l" ? "Write here. Start a line with - for a list." : "Write here"}
        aria-label="Note text"
        onChange={(e) => edit(note.id, note.title, e.target.value)}
        onKeyDown={onBodyKey}
      />
    </div>
  );
}

function Pager({ notes, activeId, size }: { readonly notes: readonly Note[]; readonly activeId: string; readonly size: SizeId }) {
  const select = useNotesStore((s) => s.select);
  const visible = notes.slice(0, size === "l" ? notes.length : PAGER_LIMIT);
  return (
    <div className={`notes__pager notes__pager--${size}`} role="tablist" aria-label="Notes">
      {visible.map((n, i) => (
        <button
          key={n.id}
          type="button"
          role="tab"
          aria-selected={n.id === activeId}
          aria-label={n.title || `Note ${i + 1}`}
          className={`notes__tab${n.id === activeId ? " notes__tab--active" : ""}`}
          onClick={() => select(n.id)}
        >
          {size === "l" ? <span className="notes__tab-label">{n.title || `Note ${i + 1}`}</span> : null}
        </button>
      ))}
    </div>
  );
}

function Empty() {
  const add = useNotesStore((s) => s.add);
  return (
    <div className="notes-empty">
      <DotIcon name="plus" className="notes-empty__icon" />
      <div className="notes-empty__copy">
        <Caps>Notes</Caps>
        <span className="notes-empty__text">No notes yet</span>
      </div>
      <button type="button" className="notes-empty__action" onClick={add}>
        New note
      </button>
    </div>
  );
}

export function NotesWidget({ size = "m", config = { textSize: "regular" } }: { readonly size?: SizeId; readonly config?: NotesConfig }) {
  const { notes, activeId, add, togglePin, cycleColor, remove } = useNotesStore();
  const [armed, setArmed] = useArmed();
  const spec = sizeSpec(NOTES_SIZES, size);
  const ordered = orderedNotes(notes);
  const active = ordered.find((n) => n.id === activeId) ?? ordered[0] ?? null;
  const onDelete = (id: string): void => {
    if (armed !== id) {
      setArmed(id);
      return;
    }
    setArmed(null);
    remove(id);
  };
  return (
    <Surface
      shape="card"
      w={spec.w}
      h={spec.h}
      label="Notes"
      className={`notes notes--${active?.color ?? "plain"} notes--text-${config.textSize} notes--${size}`}
    >
      {active ? (
        <div className="notes__layout">
          {size === "l" ? <Pager notes={ordered} activeId={active.id} size={size} /> : null}
          <Editor key={active.id} note={active} size={size} />
          <div className="notes__bar">
            {size === "m" ? <Pager notes={ordered} activeId={active.id} size={size} /> : <Caps>{`${ordered.length} / ${MAX_NOTES}`}</Caps>}
            <div className="notes__actions">
              <IconButton
                icon="pin"
                label={active.pinned ? "Unpin note" : "Pin note"}
                tone="ghost"
                size="sm"
                pressed={active.pinned}
                onClick={() => togglePin(active.id)}
              />
              <button
                type="button"
                className="notes__swatch"
                data-next={nextColor(active.color)}
                aria-label="Change note colour"
                onClick={() => cycleColor(active.id)}
              />
              <IconButton
                icon="cross"
                label={armed === active.id ? "Press again to delete this note" : "Delete note"}
                tone={armed === active.id ? "accent" : "ghost"}
                size="sm"
                onClick={() => onDelete(active.id)}
              />
              <IconButton icon="plus" label="New note" tone="ghost" size="sm" disabled={notes.length >= MAX_NOTES} onClick={add} />
            </div>
          </div>
        </div>
      ) : (
        <Empty />
      )}
    </Surface>
  );
}

export const notesWidget = defineWidget<NotesConfig>({
  id: "notes",
  name: "Notes",
  description: "Sticky notes that stay put. Pin them, colour them with your theme, keep as many as you like.",
  category: "productivity",
  sizes: NOTES_SIZES,
  providers: [],
  defaultConfig: { textSize: "regular" },
  settingsSchema: NOTES_SCHEMA,
  component: ({ config, size }: WidgetProps<NotesConfig>) => <NotesWidget size={size} config={config} />,
});
