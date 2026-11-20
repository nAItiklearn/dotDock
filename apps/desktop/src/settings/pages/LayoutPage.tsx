import { useState } from "react";
import { LIMITS, DEFAULT_SETTINGS } from "../../lib/model/defaults";
import type { MonitorId, Placement } from "../../lib/model/types";
import { getApp } from "../../lib/state/app";
import { useSettingsStore } from "../../lib/state/hooks";
import { Button, IconButton, Segmented, Shortcut, Slider, Switch } from "../../lib/ui/controls";
import { Icon } from "../../lib/ui/Icon";
import { PageHeader, Row, Section } from "../ui/layout";
import { offerUndo } from "../ui/undo";
import { clearDisplayLayout, removeWidgetFromProfile, restoreWidgetToProfile } from "../layoutActions";
import { hrefFor } from "../sections";
import { useDisplayChoices, useProfileDoc } from "../useProfileDoc";
import { monitorLayoutOf } from "../../lib/state/layoutRepo";

function LayoutWidgetsSection() {
  const app = getApp();
  const activeId = useSettingsStore((s) => s.settings.activeProfileId);
  const profileName = useSettingsStore((s) => s.settings.profiles.find((p) => p.id === s.settings.activeProfileId)?.name ?? "");
  const { doc } = useProfileDoc(activeId);
  const choices = useDisplayChoices(doc);
  const [chosen, setChosen] = useState<MonitorId | null>(null);
  const display = choices.find((c) => c.id === chosen) ?? choices.find((c) => c.isPrimary) ?? choices[0];
  const placements = doc && display ? monitorLayoutOf(doc, display.id, display.isPrimary).placements : [];

  const remove = (p: Placement): void => {
    if (!display) return;
    const target = { profileId: activeId, monitorId: display.id, isPrimary: display.isPrimary };
    void removeWidgetFromProfile(app, { ...target, placementId: p.id }).then((removed) => {
      if (removed) offerUndo(`${app.catalog.get(p.widget)?.name ?? "Widget"} removed from ${profileName}.`, () => restoreWidgetToProfile(app, { ...target, placement: removed }));
    });
  };

  return (
    <Section
      title="On the desktop"
      description={`Widgets in the ${profileName} profile.`}
      actions={
        <a className="ui-button ui-button--default" href={hrefFor("widgets")}>
          <Icon name="plus" size={16} />
          Add widget
        </a>
      }
    >
      {choices.length > 1 ? (
        <div className="row row--form">
          <span className="row__label">Display</span>
          <Segmented
            label="Display"
            value={display?.id ?? ""}
            options={choices.map((c) => ({ value: c.id, label: c.label }))}
            onChange={setChosen}
          />
        </div>
      ) : null}
      <div className="row row--block" data-setting-id="layout-widgets">
        {placements.length === 0 ? (
          <p className="empty">
            <span className="caps">Nothing here</span>
            This display has no widgets in {profileName}. Add one under Widgets.
          </p>
        ) : (
          <ul className="list" aria-label={`Widgets in ${profileName}`}>
            {placements.map((p) => {
              const meta = app.catalog.get(p.widget);
              const size = meta?.sizes.find((s) => s.id === p.size);
              return (
                <li key={p.id} className="list__row">
                  <span className="list__lead" aria-hidden="true">
                    <Icon name="widgets" size={16} />
                  </span>
                  <div className="list__main">
                    <span className="list__title">{meta?.name ?? "Unavailable widget"}</span>
                    <span className="caps">
                      {meta ? `${size?.name ?? p.size} · column ${p.x + 1}, row ${p.y + 1}` : p.widget}
                    </span>
                  </div>
                  <div className="list__actions">
                    <IconButton icon="trash" tone="danger" label={`Remove ${meta?.name ?? p.widget}`} onClick={() => remove(p)} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}

function DisplayLayoutsSection() {
  const app = getApp();
  const activeId = useSettingsStore((s) => s.settings.activeProfileId);
  const profileName = useSettingsStore((s) => s.settings.profiles.find((p) => p.id === s.settings.activeProfileId)?.name ?? "");
  const { doc } = useProfileDoc(activeId);
  const choices = useDisplayChoices(doc);
  const stored = doc ? Object.entries(doc.monitors).filter(([, layout]) => layout.placements.length > 0) : [];
  const [clearing, setClearing] = useState<string | null>(null);
  // One clear at a time: a second click before the first lands would record an empty layout as the undo.
  const clear = (id: string, label: string): void => {
    if (clearing) return;
    setClearing(id);
    void clearDisplayLayout(app, { profileId: activeId, monitorId: id })
      .then((previous) => {
        offerUndo(`Cleared ${label} in ${profileName}.`, () => app.repo.setPlacements(activeId, id, previous).then(() => undefined));
      })
      .finally(() => setClearing(null));
  };
  return (
    <Section title="Layouts per display" description="Each screen keeps its own arrangement in every profile, so unplugging one never moves the others.">
      <div className="row row--block" data-setting-id="display-layouts">
        {stored.length === 0 ? (
          <p className="empty">
            <span className="caps">No layouts</span>
            No display has widgets in {profileName} yet.
          </p>
        ) : (
          <ul className="list" aria-label="Displays with widgets">
            {stored.map(([id, layout]) => {
              const label = choices.find((c) => c.id === id)?.label ?? `Display ${id}`;
              return (
                <li key={id} className="list__row">
                  <span className="list__lead" aria-hidden="true">
                    <Icon name="display" size={16} />
                  </span>
                  <div className="list__main">
                    <span className="list__title">{label}</span>
                    <span className="caps">{layout.placements.length === 1 ? "1 widget" : `${layout.placements.length} widgets`}</span>
                  </div>
                  <div className="list__actions">
                    <Button variant="danger" icon="trash" disabled={clearing !== null} onClick={() => clear(id, label)} aria-label={`Clear ${label}`}>
                      Clear
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}

export function LayoutPage() {
  const app = getApp();
  const layout = useSettingsStore((s) => s.settings.layout);
  const editShortcut = useSettingsStore((s) => s.settings.shortcuts.toggleEditMode);
  const d = DEFAULT_SETTINGS.layout;
  const set = (patch: Partial<typeof layout>): void => app.settings.getState().update((s) => ({ ...s, layout: { ...s.layout, ...patch } }));

  return (
    <>
      <PageHeader page="layout" />

      <Section title="Edit">
        <Row
          id="edit-layout"
          label="Edit layout"
          description={
            <>
              Right-click any widget, or press <Shortcut value={editShortcut} />. Drag to move, use the corner to resize.
            </>
          }
        >
          <Button variant="primary" icon="edit" onClick={() => app.bus.send({ type: "edit-mode", on: true })}>
            Edit layout
          </Button>
        </Row>
      </Section>

      <LayoutWidgetsSection />

      <Section title="Behaviour" description="How widgets behave while you arrange them.">
        <Row
          id="collision"
          label="When widgets collide"
          description="Push moves the widget you land on out of the way. Swap trades places with it."
          isDefault={layout.collision === d.collision}
          onReset={() => set({ collision: d.collision })}
        >
          <Segmented
            label="When widgets collide"
            value={layout.collision}
            options={[
              { value: "push", label: "Push away" },
              { value: "swap", label: "Swap" },
            ]}
            onChange={(collision) => set({ collision })}
          />
        </Row>
        <Row
          id="guides"
          label="Alignment guides"
          description="Show lines when an edge or centre lines up with another widget."
          isDefault={layout.guides === d.guides}
          onReset={() => set({ guides: d.guides })}
        >
          <Switch checked={layout.guides} label="Alignment guides" onChange={(guides) => set({ guides })} />
        </Row>
        <Row
          id="lock"
          label="Lock layout"
          description="Edit mode still opens, but nothing can be moved, resized, added or removed."
          isDefault={layout.locked === d.locked}
          onReset={() => set({ locked: d.locked })}
        >
          <Switch checked={layout.locked} label="Lock layout" onChange={(locked) => set({ locked })} />
        </Row>
      </Section>

      <Section title="Grid" description="Widgets snap to a grid of equal cells.">
        <Row
          id="gap"
          label="Widget spacing"
          description="Space between neighbouring widgets."
          isDefault={layout.gap === d.gap}
          onReset={() => set({ gap: d.gap })}
        >
          <span className="control-with-value">
            <Slider label="Widget spacing" value={layout.gap} {...LIMITS.gap} valueText={`${layout.gap} pixels`} onChange={(gap) => set({ gap })} />
            <span className="control-value tabular">{layout.gap} px</span>
          </span>
        </Row>
        <Row
          id="edge"
          label="Screen edge margin"
          description="Keeps widgets this far from the edge of every screen. Set a different margin for one screen under Displays."
          isDefault={layout.edgeMargin === d.edgeMargin}
          onReset={() => set({ edgeMargin: d.edgeMargin })}
        >
          <span className="control-with-value">
            <Slider label="Screen edge margin" value={layout.edgeMargin} {...LIMITS.edgeMargin} valueText={`${layout.edgeMargin} pixels`} onChange={(edgeMargin) => set({ edgeMargin })} />
            <span className="control-value tabular">{layout.edgeMargin} px</span>
          </span>
        </Row>
      </Section>

      <DisplayLayoutsSection />
    </>
  );
}
