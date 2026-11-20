import type { ModuleId, ModuleStatus } from "../lib/native/api";

export interface ModuleCopy {
  readonly id: ModuleId;
  /** The Settings row id the search index points at. */
  readonly rowId: string;
  readonly label: string;
  readonly description: string;
}

/** In the order the parts start, which is also the order people think of them: the screen, the dock, the bar, the pill. */
export const MODULE_COPY: readonly ModuleCopy[] = [
  {
    id: "home",
    rowId: "module-home",
    label: "Home screen",
    description: "Your widgets on the desktop, behind your windows. Off closes the overlay and stops its data feeds; your layouts are kept.",
  },
  {
    id: "dock",
    rowId: "module-dock",
    label: "Dock",
    description: "Apps filed into stacks, running windows and live tiles on a bar of its own. Off closes the bar.",
  },
  {
    id: "taskbar",
    rowId: "module-taskbar",
    label: "Replace the taskbar",
    description: "Hides the Windows taskbar and lets the dock take its place. Off puts the Windows taskbar back, exactly as it was.",
  },
  {
    id: "notch",
    rowId: "module-notch",
    label: "Notch",
    description: "Agent Island, a pill at the top of the screen showing what your coding agents are doing. Off closes it and stops watching.",
  },
];

const LABELS: Readonly<Record<ModuleId, string>> = {
  home: "home screen",
  dock: "dock",
  taskbar: "taskbar replacement",
  notch: "notch",
};

export interface ModuleView {
  /** Short state shown beside the switch. */
  readonly chip: string;
  /** Whether the switch can be used right now. */
  readonly canSwitch: boolean;
  /** Why it cannot, or why it failed; null when there is nothing to add. */
  readonly note: string | null;
}

/** What Settings says about one part, from its status and the status of the part it needs. */
export function viewOf(status: ModuleStatus, all: readonly ModuleStatus[]): ModuleView {
  const needed = status.requires ? all.find((m) => m.id === status.requires) : undefined;
  const neededName = status.requires ? LABELS[status.requires] : null;
  switch (status.state) {
    case "unavailable":
      return { chip: "Not in this build", canSwitch: false, note: "This build of dotDock does not include it yet." };
    case "failed":
      return { chip: "Couldn't start", canSwitch: true, note: status.error ?? "It did not start." };
    case "running":
      return { chip: "On", canSwitch: true, note: null };
    case "waiting":
      return { chip: `Waiting for the ${neededName ?? "part it needs"}`, canSwitch: true, note: null };
    case "stopped":
      if (needed && !needed.enabled) {
        return { chip: "Off", canSwitch: false, note: `Turn the ${neededName ?? "part it needs"} on first.` };
      }
      return { chip: "Off", canSwitch: true, note: null };
  }
}

/** The list with one choice applied, as the switch should look the moment it is touched. */
export function withChoice(all: readonly ModuleStatus[], id: ModuleId, enabled: boolean): readonly ModuleStatus[] {
  return all.map((m) => {
    if (m.id === id) return { ...m, enabled };
    // A part cannot stay on without the one it needs.
    return !enabled && m.requires === id ? { ...m, enabled: false } : m;
  });
}
