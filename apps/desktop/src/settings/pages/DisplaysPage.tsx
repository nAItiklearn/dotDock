import { DEFAULT_SETTINGS, LIMITS } from "../../lib/model/defaults";
import type { DisplayInfo } from "../../lib/native/api";
import { getApp } from "../../lib/state/app";
import { useSettingsStore } from "../../lib/state/hooks";
import { Slider } from "../../lib/ui/controls";
import { Icon } from "../../lib/ui/Icon";
import { NativeGate, useNativeResource } from "../ui/native";
import { PageHeader, Row, Section } from "../ui/layout";
import { pageById } from "../pageMeta";

function DisplayCard({ display }: { readonly display: DisplayInfo }) {
  const app = getApp();
  const global = useSettingsStore((s) => s.settings.layout.edgeMargin);
  const override = useSettingsStore((s) => s.settings.displays[display.id]?.edgeMargin ?? null);
  const value = override ?? global;
  const percent = Math.round(display.scaleFactor * 100);
  const setMargin = (edgeMargin: number | null): void =>
    app.settings.getState().update((s) => ({ ...s, displays: { ...s.displays, [display.id]: { edgeMargin } } }));
  return (
    <li className="display-card">
      <div className="display-card__head">
        <span className="list__lead" aria-hidden="true">
          <Icon name="display" size={18} />
        </span>
        <div className="list__main">
          <span className="list__title">{display.name}</span>
          <span className="caps">{display.primary ? "Primary" : "Secondary"}</span>
        </div>
      </div>
      <dl className="facts">
        <div>
          <dt className="caps">Resolution</dt>
          <dd className="tabular">
            {display.bounds.width} × {display.bounds.height}
          </dd>
        </div>
        <div>
          <dt className="caps">Scaling</dt>
          <dd className="tabular">{percent}%</dd>
        </div>
        <div>
          <dt className="caps">Refresh</dt>
          <dd className="tabular">{display.refreshHz ? `${display.refreshHz} Hz` : "Unknown"}</dd>
        </div>
        <div>
          <dt className="caps">Usable area</dt>
          <dd className="tabular">
            {display.workArea.width} × {display.workArea.height}
          </dd>
        </div>
      </dl>
      <Row
        id={`display-margin-${display.id}`}
        label="Safe margin"
        description={override === null ? "Uses the global margin from Home." : "Set for this screen only."}
        isDefault={override === null}
        onReset={() => setMargin(null)}
      >
        <span className="control-with-value">
          <Slider label={`Safe margin on ${display.name}`} value={value} {...LIMITS.edgeMargin} valueText={`${value} pixels`} onChange={setMargin} />
          <span className="control-value tabular">{value} px</span>
        </span>
      </Row>
      {percent !== 100 ? (
        <p className="display-card__note">
          Windows scales this screen to {percent}%. Widgets keep their size in grid cells, so they scale with it and stay sharp.
        </p>
      ) : null}
    </li>
  );
}

export function DisplaysPage() {
  const resource = useNativeResource((api) => api.displays.list());
  const page = pageById("displays");
  const defaultMargin = DEFAULT_SETTINGS.layout.edgeMargin;
  return (
    <>
      <PageHeader title={page.title} description={page.description} />
      <NativeGate
        resource={resource}
        icon="display"
        offers={[
          "See each screen's resolution, scaling and refresh rate.",
          "Keep widgets a different distance from the edge on each screen, for example clear of the taskbar.",
          "Understand how Windows scaling affects your layout.",
        ]}
      >
        {(displays) => (
          <Section title="Screens" description={`Every screen has its own layout in each profile. The global margin starts at ${defaultMargin} pixels.`}>
            <div className="row row--block" data-setting-id="display-list">
              <ul className="display-list" aria-label="Screens">
                {displays.map((d) => (
                  <DisplayCard key={d.id} display={d} />
                ))}
              </ul>
            </div>
          </Section>
        )}
      </NativeGate>
    </>
  );
}
