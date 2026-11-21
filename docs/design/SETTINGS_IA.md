# Settings information architecture

The Settings window is organised by **part of the product**, not by kind of setting. Everything about the dock lives under Dock, everything about the notch under Notch, and so on. A person who wants to change something about a part opens that part and finds all of it there.

This file is the contract for every track that adds a page. Code: `apps/desktop/src/settings/sections.ts` (the registry), `SettingsApp.tsx` (the shell), `searchIndex.ts` (search).

## The six sections

Sidebar order. Each section has a short description shown under its title, then its pages as tabs.

| Section | Id | Pages (tab order) |
| --- | --- | --- |
| General | `general` | Startup (`startup`), About (`about`) |
| Home screen | `home` | Layout (`layout`), Profiles (`profiles`), Widgets (`widgets`), Displays (`displays`) |
| Dock | `dock` | Items, Tiles, Appearance, Behaviour, Taskbar (dock tracks) |
| Notch | `notch` | Agents (`agents`), Appearance (`notch-look`) |
| Themes & wallpaper | `themes` | Themes (`themes`), Wallpapers (`wallpapers`) |
| System & safety | `system` | Performance (`performance`), Shortcuts (`shortcuts`), Data and privacy (`data`), Recovery and logs (`recovery`) |

### No per-part switches (owner, 2026-11-20)

There is no on/off switch per part. Exactly two switches turn things off, and they sit low-key at the very end of Settings: the last section, **"dotDock and Windows"**, at the bottom of System & safety / Recovery and logs.

- **dotDock theme on/off:** the whole environment as one. Until the modules track merges its component, this place holds the existing "Use this desktop" choice (this desktop or the Windows one), which the switch replaces.
- **Use the Windows taskbar:** instead of the dock's taskbar replacement. Added by the modules track with its component; nothing stands in for it before then.

Nothing else in Settings duplicates these two. A part's own page never carries a master switch.

### What goes where

- **General / Startup:** launch at sign-in, desktop icons, the Windows startup delay. Language joins this page when a second language ships; there is no language setting until then.
- **General / About:** version, updates (check now, check automatically), credits, licences.
- **Home screen / Layout:** edit the layout, the widgets on the active profile, collision, guides, lock, grid spacing, edge margin, layouts per display.
- **Home screen / Profiles:** list, switch, rename, reset, delete, create.
- **Home screen / Widgets:** the live gallery; add a widget to the active profile.
- **Home screen / Displays:** each screen's resolution and scaling and its own safe margin.
- **Dock:** items (pinned apps, stacks, order), tiles (native tiles and their data), appearance (the dock theme), behaviour (size, magnification, auto-hide; the dock sits at the bottom only), taskbar (how the replacement behaves). The switch back to the Windows taskbar is not here; it is one of the two switches at the end of Settings. The dock tracks own these pages.
- **Notch / Agents:** connect and disconnect each agent, what the island reads, notifications and sound. New agents (Copilot CLI, OpenCode, the generic protocol) add a row each here.
- **Notch / Appearance:** show the island, idle state, dot style, size, distance from the top, which details show, movement.
- **Themes & wallpaper / Themes:** theme, switch automatically, your themes and the theme editor, theme from wallpaper (modules track), corner roundness, motion, font.
- **Themes & wallpaper / Wallpapers:** library and fit mode per display.
- **System & safety / Performance:** pause rules, refresh rate, frame stats.
- **System & safety / Shortcuts:** global hotkeys, keys while editing.
- **System & safety / Data and privacy:** what is stored, export, import, reset, cache, network use.
- **System & safety / Recovery and logs:** restore the Windows desktop, boot timing, diagnostics report, open the folder that holds the logs, and last of all the "dotDock and Windows" section with the two switches.

## Rules for every page

1. **Show only what exists.** A section with no pages on this build is not in the sidebar. A page whose feature is on another branch is not registered until it merges. No empty pages, no "coming soon".
2. **No master switch on a part's page.** The only two off switches live at the end of Settings (see above).
3. **Every setting is a `Row`** with a stable `id`, a label, a one-sentence description, and a reset button when it differs from the default. Groups of rows are `Section`s with a title and, when it helps, a description.
4. **Every row is searchable.** Add an entry to `SEARCH_ENTRIES` with the page id and row id. A test fails when a row id has no search entry or a search entry points at a row that does not exist.
5. **Routes:** `#/<section>/<page>?focus=<row id>`. `#/<section>` opens its first page. Old v1 routes (`#/home`, `#/appearance`, `#/startup` and so on) redirect to their new place, so links in notices and other windows keep working.
6. **Links between pages** use `hrefFor(page)` from `sections.ts`, never a hard-coded hash.
7. **Instant apply.** Changes apply as they are made, with no Save button. Destructive actions ask once inline and offer undo where undo is possible.
8. **Native-backed pages** wrap their body in `NativeGate`, which shows what the page will do in the desktop app when Settings runs in a plain browser.

## Adding a page (for the dock, notch and modules tracks)

1. Add the page id to `PageId` and an entry to `PAGES` in `sections.ts` with its `section`, title, icon and description.
2. Add the component to `PAGE_COMPONENTS` in `SettingsApp.tsx`.
3. Add its rows to `SEARCH_ENTRIES`.
4. The modules track's two switches go into the "dotDock and Windows" section at the end of `RecoveryPage`, replacing the "Use this desktop" row.

The section appears in the sidebar as soon as it has one page.
