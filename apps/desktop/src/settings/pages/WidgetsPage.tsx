import { useState } from "react";
import type { GridMetrics } from "../../lib/layout/grid";
import type { MonitorId, WidgetInfo } from "../../lib/model/types";
import { getApp } from "../../lib/state/app";
import { useSettingsStore } from "../../lib/state/hooks";
import { useGridMetrics } from "../../lib/state/useGridMetrics";
import { Button, Segmented, SelectField } from "../../lib/ui/controls";
import { sizesByArea } from "../../overlay/catalog";
import { WidgetPreview } from "../../overlay/WidgetPreview";
import { addWidgetToProfile, removeWidgetFromProfile } from "../layoutActions";
import { PageHeader, Section } from "../ui/layout";
import { offerUndo } from "../ui/undo";
import { useDisplayChoices, useProfileDoc, type DisplayChoice } from "../useProfileDoc";

const PREVIEW_MAX_WIDTH = 300;
const PREVIEW_MAX_HEIGHT = 140;

interface CardProps {
  readonly meta: WidgetInfo;
  readonly metrics: GridMetrics;
  readonly profileId: string;
  readonly profileName: string;
  readonly display: DisplayChoice | undefined;
}

function WidgetCard({ meta, metrics, profileId, profileName, display }: CardProps) {
  const app = getApp();
  const [sizeId, setSizeId] = useState(meta.sizes[0]?.id ?? "m");
  const [busy, setBusy] = useState(false);

  const add = (): void => {
    if (!display || busy) return;
    setBusy(true);
    const target = { profileId, monitorId: display.id as MonitorId, isPrimary: display.isPrimary };
    void addWidgetToProfile(app, { ...target, widget: meta.id, sizeId, metrics })
      .then((outcome) => {
        if (outcome.ok) {
          offerUndo(`${meta.name} added to ${profileName}.`, () => void removeWidgetFromProfile(app, { ...target, placementId: outcome.placementId }));
        } else {
          app.notices.getState().push({
            key: "layout:no-room",
            level: "info",
            message: "There's no room for that on this screen. Remove a widget or pick a smaller size.",
          });
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <li className="widget-card">
      <div className="widget-card__stage">
        <WidgetPreview meta={meta} sizeId={sizeId} metrics={metrics} maxWidth={PREVIEW_MAX_WIDTH} maxHeight={PREVIEW_MAX_HEIGHT} />
      </div>
      <div className="widget-card__text">
        <span className="widget-card__name">{meta.name}</span>
        <span className="widget-card__desc">{meta.description}</span>
      </div>
      <div className="widget-card__actions">
        {meta.sizes.length > 1 ? (
          <Segmented
            label={`${meta.name} size`}
            value={sizeId}
            options={sizesByArea(meta.sizes).map((s) => ({ value: s.id, label: s.name }))}
            onChange={setSizeId}
          />
        ) : (
          <span className="caps">{meta.sizes[0]?.w}×{meta.sizes[0]?.h} cells</span>
        )}
        <Button variant="primary" icon="plus" disabled={busy || !display} onClick={add} aria-label={`Add ${meta.name} to ${profileName}`}>
          Add
        </Button>
      </div>
    </li>
  );
}

export function WidgetsPage() {
  const app = getApp();
  const metrics = useGridMetrics();
  const activeId = useSettingsStore((s) => s.settings.activeProfileId);
  const profileName = useSettingsStore((s) => s.settings.profiles.find((p) => p.id === s.settings.activeProfileId)?.name ?? "");
  const { doc } = useProfileDoc(activeId);
  const choices = useDisplayChoices(doc);
  const [chosen, setChosen] = useState<MonitorId | null>(null);
  const display = choices.find((c) => c.id === chosen) ?? choices.find((c) => c.isPrimary) ?? choices[0];

  return (
    <>
      <PageHeader page="widgets" />
      <Section
        title="Add a widget"
        description={`Adds to the ${profileName} profile. Arrange it afterwards with Edit layout.`}
        actions={
          choices.length > 1 ? (
            <SelectField
              label="Add to display"
              value={display?.id ?? ""}
              options={choices.map((c) => ({ value: c.id, label: c.label }))}
              onChange={setChosen}
            />
          ) : undefined
        }
      >
        <div className="row row--block" data-setting-id="gallery">
          <ul className="gallery-grid" aria-label="Widgets you can add">
            {app.catalog.list().map((meta) => (
              <WidgetCard key={meta.id} meta={meta} metrics={metrics} profileId={activeId} profileName={profileName} display={display} />
            ))}
          </ul>
        </div>
      </Section>
    </>
  );
}
