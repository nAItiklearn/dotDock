/**
 * What each version of dotDock contains, in order, the planned one last. Version 1 lists only what the first release ships; the
 * version 2 list is the dock tiles that are planned and not built yet (docs/OWNER_REQUESTS.md, "Dock tiles
 * wishlist"). Dates are never written here: lib/changelog.ts takes them from the published release.
 */
import type { Version } from "../lib/changelog";

export const FIRST_VERSION = 1;

export const VERSIONS: readonly Version[] = [
  {
    major: 1,
    name: "Version 1",
    summary: "The first release: the dock, the island, the home screen and the themes, made to work as one desktop.",
    groups: [
      {
        title: "The dock",
        items: [
          "Takes the place of the Windows taskbar, which is hidden, never removed.",
          "Files your apps into stacks by kind, with a full-screen App Library to search them all.",
          "Magnification under the pointer, and live previews of open windows.",
          "Six themes: Glass, a frosted glass that blurs the desktop behind it, Glass lite, Obsidian, Paper, Aurum and Minimal.",
          "Sits at the bottom of the screen, floating over maximised windows or reserving its space.",
          "More than twenty live tiles: system load, battery, quick toggles, world and flip clocks, your day, focus timer, currency, web search, voice memo, audio devices and more.",
        ],
      },
      {
        title: "The island",
        items: [
          "A notch at the top of the screen that follows Claude Code, Codex, Copilot CLI and OpenCode.",
          "Shows thinking with the token count, the file being read, the command being run, and a one-line summary when it is done.",
          "Turns red when an agent waits for your permission, and says when a usage limit resets.",
          "Several sessions at once, in one island.",
        ],
      },
      {
        title: "The home screen",
        items: [
          "Widgets for the clock, date, battery, system, music, a fun fact, a timer and world clocks.",
          "A photo widget in eight sizes, with borders and rounded, squircle or circle shapes.",
          "Edit mode with snapping, guides, undo and redo, and saved layouts.",
          "Original wallpapers, generated from code.",
        ],
      },
      {
        title: "Themes and Settings",
        items: [
          "Obsidian, Paper and Aurum, or a theme taken from your own wallpaper, with a preview and undo.",
          "The widgets, the dock and the island change colour together.",
          "Settings in a few clear sections, ending with one switch that turns the dotDock theme on or off.",
          "A snapshot of your desktop before anything changes, and a restore tool that puts it back.",
        ],
      },
    ],
  },
  {
    major: 2,
    name: "Version 2",
    summary: "More tiles for the dock, drawn in the same dots. These are planned, not built yet; each one ships when it is ready.",
    groups: [
      {
        title: "Planned dock tiles",
        items: [
          "Unread mail, with the count and the newest sender.",
          "The year, the month and the day as rows of progress dots.",
          "A calendar week strip next to the next event.",
          "Stocks, as a short list and a chart.",
          "Developer tiles for GitHub, starred repositories, Linear and Vercel, read with a token you keep in Windows Credential Manager.",
          "An AI tokens tile, counted on your PC from the island's sessions.",
          "Sales and revenue counters, alongside the developer tiles.",
          "Follower counts for the social accounts you choose.",
          "A contribution heat map.",
          "File search, next to the web search tile.",
          "A switch in Settings to keep the Windows taskbar instead of the dock.",
        ],
      },
    ],
  },
];
