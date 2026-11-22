import { useState } from "react";
import { getNativeApi, type DisplayInfo, type WallpaperAssignment, type WallpaperFit, type WallpaperItem } from "../../lib/native/api";
import { getApp } from "../../lib/state/app";
import { Button, IconButton, SelectField } from "../../lib/ui/controls";
import { Icon } from "../../lib/ui/Icon";
import { NativeGate, useNativeResource, type NativeResource } from "../ui/native";
import { PageHeader, Row, Section } from "../ui/layout";

interface WallpaperData {
  readonly items: readonly WallpaperItem[];
  readonly assignments: readonly WallpaperAssignment[];
  readonly displays: readonly DisplayInfo[];
}

const FIT_OPTIONS: readonly { value: WallpaperFit; label: string }[] = [
  { value: "fill", label: "Fill" },
  { value: "fit", label: "Fit" },
  { value: "stretch", label: "Stretch" },
  { value: "tile", label: "Tile" },
  { value: "center", label: "Centre" },
  { value: "span", label: "Span all screens" },
];

const ALL = "all";

/** Bundled wallpapers come in a dark and a light take with one name; this tells them apart. */
const MODE_NAMES = { dark: "Dark", light: "Light" } as const;

function report(key: string, error: unknown): void {
  getApp().notices.getState().push({
    key: `native:${key}`,
    level: "error",
    message: `That didn't work: ${error instanceof Error ? error.message : String(error)}`,
  });
}

function WallpaperBody({ resource, data }: { readonly resource: NativeResource<WallpaperData>; readonly data: WallpaperData }) {
  const [target, setTarget] = useState<string>(ALL);
  const targetAssignments = target === ALL ? data.assignments : data.assignments.filter((a) => a.monitorId === target);
  const currentId = targetAssignments[0]?.wallpaperId ?? null;
  const currentFit = targetAssignments[0]?.fit ?? "fill";

  const assign = (wallpaperId: string | null, fit: WallpaperFit): void => {
    getNativeApi()
      .wallpapers.assign(target, wallpaperId, fit)
      .then((assignments) => resource.set({ ...data, assignments }), (error: unknown) => report("wallpaper", error));
  };
  const importOne = (): void => {
    getNativeApi()
      .wallpapers.importFile()
      .then(
        (item) => {
          if (item) resource.set({ ...data, items: [...data.items, item] });
        },
        (error: unknown) => report("wallpaper-import", error),
      );
  };
  const remove = (item: WallpaperItem): void => {
    getNativeApi()
      .wallpapers.remove(item.id)
      .then(
        () => resource.reload(),
        (error: unknown) => report("wallpaper-remove", error),
      );
  };

  return (
    <>
      <Section
        title="Library"
        description="Pick a wallpaper for the selected screen. Your original wallpaper is always kept."
        actions={
          <div className="section__buttons">
            {data.displays.length > 1 ? (
              <SelectField
                label="Apply to"
                value={target}
                options={[{ value: ALL, label: "All screens" }, ...data.displays.map((d) => ({ value: d.id, label: d.name }))]}
                onChange={setTarget}
              />
            ) : null}
            <Button icon="upload" onClick={importOne}>
              Import
            </Button>
          </div>
        }
      >
        <div className="row row--block" data-setting-id="wallpaper-library">
          <ul className="wallpaper-grid" aria-label="Wallpapers">
            <li>
              <button type="button" className={`wallpaper${currentId === null ? " is-selected" : ""}`} aria-pressed={currentId === null} onClick={() => assign(null, currentFit)}>
                <span className="wallpaper__thumb wallpaper__thumb--original" aria-hidden="true">
                  <Icon name="restore" size={22} />
                </span>
                <span className="wallpaper__name">Original</span>
              </button>
            </li>
            {data.items.map((item) => (
              <li key={item.id} className="wallpaper-grid__item">
                <button type="button" className={`wallpaper${currentId === item.id ? " is-selected" : ""}`} aria-pressed={currentId === item.id} onClick={() => assign(item.id, currentFit)}>
                  <img className="wallpaper__thumb" src={item.thumbnailUrl} alt="" loading="lazy" />
                  <span className="wallpaper__name">
                    {item.name}
                    {item.mode ? <span className="wallpaper__mode">{MODE_NAMES[item.mode]}</span> : null}
                  </span>
                </button>
                {item.source === "imported" ? (
                  <span className="wallpaper-grid__remove">
                    <IconButton icon="trash" tone="danger" label={`Remove ${item.name}`} onClick={() => remove(item)} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <Row id="wallpaper-fit" label="Fit mode" description="How the picture fills the screen when its shape doesn't match.">
          <SelectField label="Fit mode" value={currentFit} options={FIT_OPTIONS} onChange={(fit) => assign(currentId, fit)} />
        </Row>
      </Section>
    </>
  );
}

export function WallpapersPage() {
  const resource = useNativeResource(
    async (api): Promise<WallpaperData> => {
      const [items, assignments, displays] = await Promise.all([api.wallpapers.list(), api.wallpapers.assignments(), api.displays.list()]);
      return { items, assignments, displays };
    },
  );
  return (
    <>
      <PageHeader page="wallpapers" />
      <NativeGate
        resource={resource}
        icon="wallpaper"
        offers={[
          "Choose from the bundled wallpapers or import your own pictures.",
          "Set a different wallpaper on each screen, with fill, fit, tile or span.",
          "Go back to your original wallpaper at any time.",
        ]}
      >
        {(data) => <WallpaperBody resource={resource} data={data} />}
      </NativeGate>
    </>
  );
}
