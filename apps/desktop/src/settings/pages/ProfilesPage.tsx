import { useState } from "react";
import { LIMITS } from "../../lib/model/defaults";
import { getApp } from "../../lib/state/app";
import { useSettingsStore } from "../../lib/state/hooks";
import { Button, IconButton, Segmented, TextField } from "../../lib/ui/controls";
import { PageHeader, Section } from "../ui/layout";
import { offerUndo } from "../ui/undo";

interface ProfileRowProps {
  readonly id: string;
  readonly name: string;
  readonly builtin: boolean;
  readonly active: boolean;
}

function ProfileRow({ id, name, builtin, active }: ProfileRowProps) {
  const app = getApp();
  const settings = app.settings.getState();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [resetting, setResetting] = useState(false);

  const startRename = (): void => {
    // Start from the current name, not from whatever was typed and abandoned last time.
    setDraft(name);
    setRenaming(true);
  };
  const commitRename = (): void => {
    const next = draft.trim();
    if (next !== "" && next !== name) settings.renameProfile(id, next);
    setRenaming(false);
  };
  const resetLayout = (): void => {
    if (resetting) return;
    setResetting(true);
    void (async () => {
      const before = await app.repo.load(id);
      await app.repo.reset(id);
      offerUndo(`${name} layout reset.`, () => void app.repo.replace(id, before));
    })().finally(() => setResetting(false));
  };

  return (
    <li className={`list__row${active ? " is-active" : ""}`}>
      <span className="list__lead" aria-hidden="true">
        {active ? <span className="status-dot" /> : null}
      </span>
      <div className="list__main">
        {renaming ? (
          <TextField label={`Rename ${name}`} value={draft} maxLength={LIMITS.profileNameLength} onChange={setDraft} onCommit={commitRename} onCancel={() => setRenaming(false)} autoFocus />
        ) : (
          <>
            <span className="list__title">{name}</span>
            <span className="caps">{active ? "Active" : builtin ? "Built in" : "Yours"}</span>
          </>
        )}
      </div>
      <div className="list__actions">
        {active ? null : (
          <Button onClick={() => settings.setActiveProfile(id)} aria-label={`Use ${name}`}>
            Use
          </Button>
        )}
        <IconButton
          icon={renaming ? "check" : "edit"}
          label={renaming ? `Save the name of ${name}` : `Rename ${name}`}
          onClick={renaming ? commitRename : startRename}
          // While renaming, keep focus in the field: a blur would commit and re-render this button mid-click.
          onMouseDown={renaming ? (e) => e.preventDefault() : undefined}
          active={renaming}
        />
        {builtin ? (
          <IconButton icon="reset" label={`Reset ${name} to its original layout`} disabled={resetting} onClick={resetLayout} />
        ) : (
          <IconButton
            icon="trash"
            tone="danger"
            label={`Delete ${name}`}
            onClick={() => {
              void settings.deleteProfile(id).then((restore) => {
                if (restore) offerUndo(`${name} deleted.`, restore);
              });
            }}
          />
        )}
      </div>
    </li>
  );
}

export function ProfilesPage() {
  const profiles = useSettingsStore((s) => s.settings.profiles);
  const activeId = useSettingsStore((s) => s.settings.activeProfileId);
  const [name, setName] = useState("");
  const [source, setSource] = useState<"current" | "empty">("current");
  const [creating, setCreating] = useState(false);
  const userCount = profiles.filter((p) => !p.builtin).length;
  const full = userCount >= LIMITS.maxProfiles;
  const canCreate = name.trim() !== "" && !full && !creating;

  // Enter in the name field and the Create button share this path, so neither can bypass the limit
  // or create the same profile twice while the first one is still being written.
  const create = (): void => {
    if (!canCreate) return;
    setCreating(true);
    void getApp()
      .settings.getState()
      .createProfile(name, source)
      .then((id) => {
        if (id) setName("");
      })
      .finally(() => setCreating(false));
  };

  return (
    <>
      <PageHeader page="profiles" />
      <Section title="Profiles" description="A profile is a complete arrangement of widgets. Switch between them here or with the Next profile hotkey.">
        <div className="row row--block" data-setting-id="profiles">
          <ul className="list" aria-label="Layout profiles">
            {profiles.map((p) => (
              <ProfileRow key={p.id} id={p.id} name={p.name} builtin={p.builtin} active={p.id === activeId} />
            ))}
          </ul>
        </div>
      </Section>
      <Section
        title="New profile"
        description={full ? `You have ${LIMITS.maxProfiles} profiles of your own, the most there can be. Delete one to make another.` : "Starts as a copy of the active profile, or empty."}
      >
        <div className="row row--form" data-setting-id="new-profile">
          <TextField label="New profile name" placeholder="Name a new profile" value={name} maxLength={LIMITS.profileNameLength} onChange={setName} onCommit={create} commitOnBlur={false} />
          <Segmented
            label="Start the new profile from"
            value={source}
            options={[
              { value: "current", label: "Copy of active" },
              { value: "empty", label: "Empty" },
            ]}
            onChange={setSource}
          />
          <Button icon="plus" variant="primary" disabled={!canCreate} onClick={create}>
            Create
          </Button>
        </div>
      </Section>
    </>
  );
}
