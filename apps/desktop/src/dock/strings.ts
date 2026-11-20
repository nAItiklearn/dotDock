import type { BuiltinCategoryId, Category } from "./protocol";

/** English copy. Every string the dock shows lives here so a translation is one more dictionary. */
const EN = {
  "dock.label": "Dock",
  "library.open": "App Library",
  "library.title": "App Library",
  "library.search": "Search apps",
  "library.search.label": "Search apps",
  "library.close": "Close App Library",
  "library.empty.title": "No apps match “{query}”",
  "library.empty.hint": "Try a shorter name, a publisher or a category.",
  "library.none.title": "No apps yet",
  "library.none.hint": "Apps appear here once the Start menu has been read.",
  "library.count.one": "{count} app",
  "library.count.other": "{count} apps",
  "library.result.copy": "Copy result",
  "library.result.copied": "Copied",

  "stack.filter": "Type to filter",
  "stack.empty.title": "Nothing filed here",
  "stack.empty.hint": "Apps you file in this category show up in this stack.",
  "stack.nomatch": "No match for “{query}”",
  "stack.close": "Close stack",
  "stack.new.one": "{count} new",
  "stack.new.other": "{count} new",

  "item.new": "New",
  "item.running.one": "{count} window",
  "item.running.other": "{count} windows",

  "menu.open": "Open",
  "menu.newWindow": "New window",
  "menu.pin": "Keep in dock",
  "menu.unpin": "Remove from dock",
  "menu.moveToStack": "Move to stack",
  "menu.closeWindow": "Close window",
  "menu.closeAll": "Close all windows",
  "menu.openStack": "Open stack",
  "menu.removeStack": "Remove stack",
  "menu.editDock": "Edit dock",
  "menu.doneEditing": "Done editing",
  "menu.library": "Show App Library",
  "menu.removeTile": "Remove tile",

  "edit.done": "Done",
  "edit.add": "Add to dock",
  "edit.add.stacks": "Stacks",
  "edit.add.tiles": "Live tiles",
  "edit.add.none": "Everything is on the dock already.",
  "edit.remove": "Remove {name}",
  "edit.hint": "Drag to reorder. Drop an app on a stack to file it there.",

  "tile.clock": "Clock",
  "tile.media": "Now playing",
  "tile.system": "System",
  "tile.media.idle": "Nothing playing",
  "tile.media.play": "Play",
  "tile.media.pause": "Pause",
  "tile.system.memory": "Memory",
  "tile.system.cpu": "Processor",
  "tile.system.window": "Last 60 seconds",
  "tile.contacts": "Contacts",
  "tile.meeting": "Next meeting",
  "tile.stopwatch": "Stopwatch",
  "tile.mic": "Microphone",
  "tile.hydration": "Water",
  "tile.focus": "Focus",
  "tile.progress": "Progress",
  "tile.reminders": "Reminders",
  "tile.agenda": "Today",
  "tile.audio": "Sound",
  "tile.close": "Close",
  "tile.issue.unsupported": "Not available",
  "tile.issue.unsupported.hint": "The dock service has not provided this yet.",
  "tile.issue.no-device": "No device found",
  "tile.issue.no-device.hint": "Connect one and it appears here.",
  "tile.issue.offline": "Offline",
  "tile.issue.offline.hint": "It updates when the connection is back.",
  "tile.issue.error": "Could not read this",
  "tile.issue.error.hint": "It will try again on its own.",
  "tile.issue.needs-setup": "Needs setting up",
  "tile.issue.needs-setup.hint": "Choose what to show in the dock settings.",
  "tile.failed": "That did not work",

  "tile.contacts.empty": "No contacts yet",
  "tile.contacts.empty.hint": "Choose people in the dock settings to reach them from here.",
  "tile.contacts.call": "Call",
  "tile.contacts.video": "Video",
  "tile.contacts.message": "Message",
  "tile.contacts.act": "{action} {name} with {app}",
  "tile.contacts.more": "{count} more",

  "tile.meeting.none": "No meetings today",
  "tile.meeting.none.hint": "The next event on your calendar shows here.",
  "tile.meeting.join": "Join",
  "tile.meeting.joinWith": "Join with {service}",
  "tile.meeting.when": "{start} to {end}",
  "tile.meeting.live": "Now",
  "tile.meeting.over": "Ended",
  "tile.meeting.seconds": "in under a minute",
  "tile.meeting.minutes": "in {count} min",
  "tile.meeting.hours": "in {hours} h",
  "tile.meeting.hoursMinutes": "in {hours} h {minutes}",
  "tile.meeting.days": "in {count} d",

  "tile.stopwatch.start": "Start",
  "tile.stopwatch.pause": "Pause",
  "tile.stopwatch.lap": "Lap",
  "tile.stopwatch.reset": "Reset",
  "tile.stopwatch.laps.none": "Laps appear here",
  "tile.stopwatch.lap.number": "Lap {number}",
  "tile.stopwatch.fastest": "Fastest",
  "tile.stopwatch.slowest": "Slowest",

  "tile.mic.mute": "Mute microphone",
  "tile.mic.unmute": "Unmute microphone",
  "tile.mic.muted": "Muted",
  "tile.mic.live": "Listening",

  "tile.hydration.of": "{logged} of {goal}",
  "tile.hydration.glass": "Drink a glass, {amount}",
  "tile.hydration.next": "Next reminder at {time}",
  "tile.hydration.off": "Reminders are off",
  "tile.hydration.snooze": "Snooze {minutes} min",
  "tile.hydration.reached": "Goal reached",

  "tile.focus.session": "Session {number} of {total}",
  "tile.focus.phase.focus": "Focus",
  "tile.focus.phase.short": "Short break",
  "tile.focus.phase.long": "Long break",
  "tile.focus.start": "Start",
  "tile.focus.resume": "Resume",
  "tile.focus.pause": "Pause",
  "tile.focus.skip": "Skip",
  "tile.focus.reset": "Reset",
  "tile.focus.break": "Then a {minutes} min break",
  "tile.focus.busy": "A timer is already running on your home screen.",

  "tile.progress.day": "Day",
  "tile.progress.month": "Month",
  "tile.progress.year": "Year",
  "tile.progress.percent": "{percent}%",

  "tile.reminders.none": "Nothing to do",
  "tile.reminders.none.hint": "Reminders you add show up here and on the home screen.",
  "tile.reminders.add": "Add a reminder",
  "tile.reminders.placeholder": "Remind me to…",
  "tile.reminders.overdue": "{count} overdue",
  "tile.reminders.today": "{count} today",
  "tile.reminders.open.one": "{count} open",
  "tile.reminders.open.other": "{count} open",
  "tile.reminders.complete": "Mark {text} as done",
  "tile.reminders.reopen": "Mark {text} as not done",
  "tile.reminders.delete": "Delete {text}",
  "tile.reminders.due.overdue": "Overdue",
  "tile.reminders.due.today": "Today",

  "tile.agenda.none": "Nothing on today",
  "tile.agenda.none.hint": "Events from your calendar show here.",
  "tile.agenda.more": "+{count} more",
  "tile.agenda.allDay": "All day",
  "tile.agenda.live": "Now",
  "tile.agenda.earlier": "Earlier today",
  "tile.agenda.later": "Still to come",

  "tile.audio.output": "Play sound through",
  "tile.audio.volume": "Volume",
  "tile.audio.mute": "Mute",
  "tile.audio.unmute": "Unmute",
  "tile.audio.none": "No sound devices",
  "tile.audio.percent": "{percent}%",

  "status.label": "Status",
  "status.online": "Online",
  "status.offline": "Offline",
  "status.battery": "Battery {percent}%",
  "status.battery.charging": "Battery {percent}%, charging",

  "launch.failed": "Could not open {name}",
  "activate.failed": "Could not switch to {name}",
  "setting.failed": "Could not save the change",

  "preview.windows.one": "{count} window",
  "preview.windows.other": "{count} windows",
  "preview.more": "{count} more",
  "preview.untitled": "Untitled window",
  "preview.minimized": "Minimised",
} as const;

export type StringKey = keyof typeof EN;

export function t(key: StringKey, vars?: Readonly<Record<string, string | number>>): string {
  let text: string = EN[key];
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

const plurals = new Intl.PluralRules("en");

/** "3 apps" / "1 app": picks the `.one` or `.other` string by the count's plural category. */
export function plural(base: "library.count" | "stack.new" | "item.running" | "preview.windows" | "tile.reminders.open", count: number): string {
  const form = plurals.select(count) === "one" ? "one" : "other";
  return t(`${base}.${form}` as StringKey, { count });
}

const BUILTIN_NAMES: Record<BuiltinCategoryId, string> = {
  productivity: "Productivity",
  communication: "Communication",
  development: "Development",
  ai: "AI",
  creative: "Creative",
  browsers: "Browsers",
  media: "Media",
  games: "Games",
  utilities: "Utilities",
  system: "System",
  other: "Other",
};

const CUSTOM_FALLBACK = "Stack";

/** The name shown for a category: the user's own, else the built-in name for its id. */
export function categoryLabel(category: Pick<Category, "id" | "name">): string {
  if (category.name !== null && category.name.trim() !== "") return category.name;
  return (BUILTIN_NAMES as Record<string, string | undefined>)[category.id] ?? CUSTOM_FALLBACK;
}
