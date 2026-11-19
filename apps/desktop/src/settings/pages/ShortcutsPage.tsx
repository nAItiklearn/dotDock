import { useEffect, useState } from "react";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS } from "../../lib/model/defaults";
import type { ShortcutAction } from "../../lib/model/types";
import { getNativeApi, type ShortcutStatus } from "../../lib/native/api";
import { getApp } from "../../lib/state/app";
import { useSettingsStore } from "../../lib/state/hooks";
import { chordFromEvent, findConflicts, formatShortcut, globalShortcutIssue, type ShortcutIssue } from "../../lib/shortcuts";
import { Button, Kbd, Shortcut } from "../../lib/ui/controls";
import { PageHeader, Row, Section } from "../ui/layout";
import { pageById } from "../pageMeta";

const ACTION_COPY: Readonly<Record<ShortcutAction, { readonly label: string; readonly description: string }>> = {
  toggleEditMode: { label: "Edit layout", description: "Enter or leave edit mode from anywhere in Windows." },
  openSettings: { label: "Open Settings", description: "Bring this window to the front." },
  nextProfile: { label: "Next profile", description: "Step through your layout profiles in order." },
};

const ISSUE_COPY: Readonly<Record<ShortcutIssue, string>> = {
  invalid: "That isn't a key combination.",
  "needs-modifier": "Add Ctrl, Alt or the Windows key, so it never gets in the way of typing.",
  reserved: "Windows and most apps already use that one.",
};

const STATUS_COPY: Readonly<Record<ShortcutStatus, string | null>> = {
  ok: null,
  conflict: "Another app already has this combination, so it won't fire.",
  invalid: "Windows rejected this combination.",
};

/** Each entry is one or more alternative key groups; keys inside a group are pressed together. */
const EDIT_KEYS: readonly { readonly alternatives: readonly (readonly string[])[]; readonly does: string }[] = [
  { alternatives: [["Ctrl", "Z"]], does: "Undo, up to 50 steps" },
  { alternatives: [["Ctrl", "Shift", "Z"], ["Ctrl", "Y"]], does: "Redo" },
  { alternatives: [["Ctrl", "D"]], does: "Duplicate the selected widget" },
  { alternatives: [["Delete"]], does: "Remove the selected widget" },
  { alternatives: [["↑"], ["↓"], ["←"], ["→"]], does: "Move the selected widget one cell" },
  { alternatives: [["+"], ["−"]], does: "Step the selected widget to a larger or smaller size" },
  { alternatives: [["Esc"]], does: "Close the panel, then leave edit mode and save" },
];

interface RecorderProps {
  readonly action: ShortcutAction;
  readonly current: string;
  readonly bindings: Readonly<Record<ShortcutAction, string>>;
  readonly onSet: (shortcut: string) => void;
}

/** Click, then press the combination. Escape cancels. Problems are explained, never silently accepted. */
function Recorder({ action, current, bindings, onSet }: RecorderProps) {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const label = ACTION_COPY[action].label;

  useEffect(() => {
    if (!listening) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setListening(false);
        setProblem(null);
        return;
      }
      const chord = chordFromEvent(e);
      if (!chord) return;
      const shortcut = formatShortcut(chord);
      const issue = globalShortcutIssue(shortcut);
      if (issue) {
        setProblem(ISSUE_COPY[issue]);
        return;
      }
      const clash = SHORTCUT_ACTIONS.find((other) => other !== action && bindings[other] === shortcut);
      if (clash) {
        setProblem(`${ACTION_COPY[clash].label} already uses ${shortcut}.`);
        return;
      }
      onSet(shortcut);
      setListening(false);
      setProblem(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, action, bindings, onSet]);

  return (
    <div className="recorder">
      <button
        type="button"
        className={`recorder__button${listening ? " is-listening" : ""}`}
        aria-label={listening ? `Press the new keys for ${label}. Escape cancels.` : `${label} shortcut: ${current}. Press to change.`}
        onClick={() => {
          setListening(!listening);
          setProblem(null);
        }}
        onBlur={() => setListening(false)}
      >
        {listening ? <span className="caps">Press keys…</span> : <Shortcut value={current} />}
      </button>
      {problem ? (
        <p className="recorder__problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

export function ShortcutsPage() {
  const app = getApp();
  const bindings = useSettingsStore((s) => s.settings.shortcuts);
  const [statuses, setStatuses] = useState<Readonly<Partial<Record<ShortcutAction, ShortcutStatus>>>>({});
  const conflicts = findConflicts(bindings);

  // Ask the core how Windows took the bindings, so a clash with another app is visible here.
  useEffect(() => {
    const native = getNativeApi();
    if (!native.available) return;
    native.shortcuts.register(bindings).then(setStatuses, () => setStatuses({}));
  }, [bindings]);

  const set = (action: ShortcutAction, shortcut: string): void =>
    app.settings.getState().update((s) => ({ ...s, shortcuts: { ...s.shortcuts, [action]: shortcut } }));
  const page = pageById("shortcuts");

  return (
    <>
      <PageHeader title={page.title} description={page.description} />
      <Section title="Global hotkeys" description="These work from any app. Each needs Ctrl, Alt or the Windows key.">
        {SHORTCUT_ACTIONS.map((action) => {
          const status = statuses[action];
          const note = (conflicts.has(action) ? "Two actions share this combination." : null) ?? (status ? STATUS_COPY[status] : null);
          return (
            <Row
              key={action}
              id={`shortcut-${action}`}
              label={ACTION_COPY[action].label}
              description={note ? <span className="row__warn">{note}</span> : ACTION_COPY[action].description}
              isDefault={bindings[action] === DEFAULT_SHORTCUTS[action]}
              onReset={() => set(action, DEFAULT_SHORTCUTS[action])}
            >
              <Recorder action={action} current={bindings[action]} bindings={bindings} onSet={(shortcut) => set(action, shortcut)} />
            </Row>
          );
        })}
      </Section>

      <Section title="While editing" description="These keys work in edit mode. They can't be changed.">
        <div className="row row--block" data-setting-id="edit-keys">
          <table className="keys">
            <caption className="sr-only">Keys that work in edit mode</caption>
            <tbody>
              {EDIT_KEYS.map(({ alternatives, does }) => (
                <tr key={does}>
                  <th scope="row">
                    {alternatives.map((group, i) => (
                      <span key={group.join("+")} className="keys__group">
                        {i > 0 ? <span className="keys__or">or</span> : null}
                        <span className="ui-shortcut">
                          {group.map((key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </span>
                      </span>
                    ))}
                  </th>
                  <td>{does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <p className="footnote">
        <Button
          variant="ghost"
          icon="reset"
          onClick={() => SHORTCUT_ACTIONS.forEach((a) => set(a, DEFAULT_SHORTCUTS[a]))}
          disabled={SHORTCUT_ACTIONS.every((a) => bindings[a] === DEFAULT_SHORTCUTS[a])}
        >
          Reset all hotkeys
        </Button>
      </p>
    </>
  );
}
