import { useEffect, useState } from "react";
import { getNativeApi, type ModuleId, type ModuleStatus } from "../../lib/native/api";
import { getApp } from "../../lib/state/app";
import { Switch } from "../../lib/ui/controls";
import { MODULE_COPY, viewOf, withChoice } from "../modulesModel";
import { NativeGate, useNativeResource, type NativeResource } from "../ui/native";
import { PageHeader, Row, Section } from "../ui/layout";
import { pageById } from "../pageMeta";

type Statuses = readonly ModuleStatus[];

/** Keeps the list in step with the core, which pushes a new one whenever any part starts or stops. */
function useLiveStatuses(resource: NativeResource<Statuses>): void {
  const ready = resource.state.status === "ready";
  const { set } = resource;
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    let stop: (() => void) | null = null;
    getNativeApi()
      .modules.onChange(set)
      .then(
        (unlisten) => {
          if (cancelled) unlisten();
          else stop = unlisten;
        },
        () => undefined,
      );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [ready, set]);
}

function ModulesBody({ resource, statuses }: { readonly resource: NativeResource<Statuses>; readonly statuses: Statuses }) {
  // Switches move the moment they are touched; the core's answer then confirms or puts them back.
  const [pending, setPending] = useState<ReadonlyMap<ModuleId, boolean>>(new Map());
  const shown = [...pending].reduce<Statuses>((list, [id, enabled]) => withChoice(list, id, enabled), statuses);

  const change = (id: ModuleId, enabled: boolean): void => {
    setPending((p) => new Map(p).set(id, enabled));
    getNativeApi()
      .modules.set(id, enabled)
      .then(resource.set, (error: unknown) =>
        getApp().notices.getState().push({
          key: `native:module-${id}`,
          level: "error",
          message: `That didn't change: ${error instanceof Error ? error.message : String(error)}`,
        }),
      )
      .finally(() =>
        setPending((p) => {
          const next = new Map(p);
          next.delete(id);
          return next;
        }),
      );
  };

  return (
    <Section title="Parts" description="Each part runs on its own. Switch off what you don't use; it stops at once and stays off.">
      {MODULE_COPY.map((copy) => {
        const status = shown.find((m) => m.id === copy.id);
        if (!status) return null;
        const view = viewOf(status, shown);
        return (
          <Row
            key={copy.id}
            id={copy.rowId}
            label={copy.label}
            description={
              <>
                {copy.description}
                {view.note ? <span className={status.state === "failed" ? "row__warn" : undefined}> {view.note}</span> : null}
              </>
            }
          >
            <span className="chip">{view.chip}</span>
            <Switch
              checked={status.enabled}
              label={copy.label}
              disabled={!view.canSwitch || pending.has(copy.id)}
              onChange={(enabled) => change(copy.id, enabled)}
            />
          </Row>
        );
      })}
    </Section>
  );
}

export function ModulesPage() {
  const resource = useNativeResource((api) => api.modules.list());
  useLiveStatuses(resource);
  const page = pageById("modules");
  return (
    <>
      <PageHeader title={page.title} description={page.description} />
      <NativeGate
        resource={resource}
        icon="settings"
        offers={[
          "Turn the home screen, the dock, the taskbar replacement and the notch on or off, each by itself.",
          "See at once whether a part is running, and why one did not start.",
          "Get the Windows taskbar back the moment the replacement is switched off.",
        ]}
      >
        {(statuses) => <ModulesBody resource={resource} statuses={statuses} />}
      </NativeGate>
    </>
  );
}
