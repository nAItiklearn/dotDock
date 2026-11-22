import { getApp } from "../../lib/state/app";
import { useLayoutStore, useSettingsStore } from "../../lib/state/hooks";
import { Button, IconButton } from "../../lib/ui/controls";
import { announce, editUi, useEditUi } from "../editUi";

/** The floating control strip at the bottom of the screen while the layout is being edited. */
export function Toolbar({ openSettings }: { readonly openSettings: () => void }) {
  const app = getApp();
  const canUndo = useLayoutStore((s) => s.canUndo);
  const canRedo = useLayoutStore((s) => s.canRedo);
  const locked = useSettingsStore((s) => s.settings.layout.locked);
  const profileName = useSettingsStore((s) => s.settings.profiles.find((p) => p.id === s.settings.activeProfileId)?.name ?? "");
  const drawerOpen = useEditUi((s) => s.drawerOpen);

  const toggleDrawer = (): void => editUi.setState({ drawerOpen: !drawerOpen, drawerTab: "add", addAt: null });
  const toggleLock = (): void => {
    app.settings.getState().update((s) => ({ ...s, layout: { ...s.layout, locked: !s.layout.locked } }));
    announce(locked ? "Layout unlocked" : "Layout locked");
  };

  return (
    <div className="toolbar" data-hit role="toolbar" aria-label="Edit layout">
      <div className="toolbar__panel">
        <div className="toolbar__title">
          <span className="toolbar__dot" aria-hidden="true" />
          <span className="caps">Editing</span>
          <span className="toolbar__profile">{profileName}</span>
        </div>
        <span className="toolbar__divider" aria-hidden="true" />
        <IconButton icon="undo" label="Undo (Ctrl+Z)" disabled={!canUndo || locked} onClick={() => app.layout.getState().undo()} />
        <IconButton icon="redo" label="Redo (Ctrl+Shift+Z)" disabled={!canRedo || locked} onClick={() => app.layout.getState().redo()} />
        <span className="toolbar__divider" aria-hidden="true" />
        <Button icon="plus" disabled={locked} aria-expanded={drawerOpen} aria-controls="edit-drawer" onClick={toggleDrawer}>
          Widgets
        </Button>
        <IconButton icon={locked ? "lock" : "unlock"} label={locked ? "Unlock layout" : "Lock layout"} active={locked} aria-pressed={locked} onClick={toggleLock} />
        <IconButton icon="settings" label="Open Settings" onClick={openSettings} />
        <Button variant="primary" icon="check" onClick={() => void app.layout.getState().exitEdit()}>
          Done
        </Button>
      </div>
    </div>
  );
}
