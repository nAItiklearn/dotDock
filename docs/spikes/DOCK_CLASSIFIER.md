# Dock classifier: accuracy on a real machine (D2)

Crate `dotdock-dock`, modules `catalogue` and `classify`. Run on 2026-11-20 against the owner's laptop
(Windows 11, 214 launchable apps after de-duplication). Reproduce with
`cargo run -p dotdock-dock --example classify_probe` (one app per line) or `-- --fixture` (rows for the golden file).

## Method
1. `catalogue::enumerate()` read both Start menu folders and `shell:AppsFolder`, merged duplicates and dropped
   uninstallers, readmes, help and web links: 214 apps (63 Store apps, 151 desktop apps).
2. `classify` filed each app. Order: the user's own filing, the bundled table, package-identity rules for Store apps,
   rules on the Start menu folder, the publisher and keywords in the name, then "Other".
3. Every one of the 214 lines was read by hand and judged against what a person would expect to find in that
   category. The judged result of 208 of them is `apps/desktop/src-tauri/dock/src/classify/golden.tsv` and is
   replayed by the test `reviewed_machine_apps_stay_where_they_were_filed`. Six of the owner's own small tools are
   left out of the committed file (the four in "Other" below and two the table files by name).

## Result
| Category | Apps | | Category | Apps |
|---|---|---|---|---|
| Development | 48 | | Productivity | 18 |
| System | 40 | | Communication | 13 |
| Utilities | 39 | | Media | 11 |
| Games | 21 | | Creative | 8 |
| Browsers | 6 | | AI | 6 |
| Other | 4 | | **Total** | **214** |

How they were filed (`FiledBy`): bundled table 200 (`known`), package identity 3 (`store`), folder, publisher or
keyword rules 7 (`rule`), fallback 4 (`fallback`, all in Other).

**Accuracy: 210 of 214 correct on the first judged run, 98.1 %** (gate: 90 %). After the four fixes below all 214 are
where they were judged to belong, and the golden test pins that.

Caveat, stated plainly: the bundled table was written while looking at this machine's list, so 98 % is the figure on
the machine it was tuned on. The part that does not depend on that is the held-out check: the unit tests file about
230 well-known names written without looking at this machine's list (browsers, IDEs, AI, chat, Office, Adobe,
games, players, archivers, vendor tools; many are not installed here) and about 20 "unknown app" cases that rely on
folder, publisher and keyword rules. On the first run of that set one name was missing from the table (KeePassXC);
it was added. Expect a lower figure on a machine with many apps nobody has listed; those land in the keyword
rules or in "Other", and the user's drag decides the rest.

## The four misfiles found by the review, and the fixes
| App | Filed as | Should be | Cause and fix |
|---|---|---|---|
| Cursor (a Brave web app shortcut) | Browsers | Development | Brave's AppUserModelID prefix `brave.` also matches its web apps (`Brave._crx_...`). Removed the prefix; Brave itself is matched by name and executable. |
| Adobe Acrobat DC, Acrobat Distiller DC | Creative | Productivity | The Adobe publisher/folder rule would have caught them, and an entry in the creative group matched first. Acrobat now sits in Productivity ahead of the vendor rule. |
| Anker Launcher | Utilities | Games | A guessed AppUserModelID entry put it in Utilities. Removed; its publisher (`ankergames`) now files it as Games by rule. |

## Judgement calls (confusion notes)
These are decisions where two categories are both defensible. They are fixed in the table and each is covered by a
test, so changing one is a one-line edit.
- **Social apps** (Instagram, Pinterest, Reddit, Snapchat, Tumblr, Twitter) are Communication, not Media.
- **Terminals**: Windows Terminal, Git Bash, PowerShell 7, WSL are Development; Command Prompt and the Windows
  PowerShell shortcuts (they live in the "System Tools" / "Windows PowerShell" Start folders) are System. The task
  asked for "Terminal if not dev"; a rule that depends on what else is installed would move an icon when another
  app is installed, so it is a fixed rule instead (logged in `docs/DECISIONS.md`).
- **Cloud drives** (OneDrive, Google Drive) are Productivity; **Clock, Weather, Calculator, Notepad, Snipping Tool,
  Sound Recorder, Quick Assist** are Utilities (as the spec lists Calculator, Notepad and Snipping Tool there).
- **Windows administration tools** (Event Viewer, Services, Registry Editor, ODBC, Disk Cleanup) and the
  accessibility tools are System. **Hardware vendor tools** (AMD, NVIDIA, Lenovo, CodeMeter) are Utilities: System is
  kept for the operating system itself.
- **Game launchers and Steam games** are Games, including `steam://rungameid/...` shortcuts, which are recognised by
  their target. Store apps published as `www.msn.com` are MSN's web games and go to Games by package rule.
- **Game dev tools** (Unity Hub, Tiled, Bootstrap Studio-style editors) were split by what they make: Unity Hub is
  Development, Tiled (a map painter) is Creative.
- **Camera, Photos, Media Player, Microsoft News, Dolby Access** are Media.

## Other (4 apps)
Four tools with no publisher, no Start folder worth reading and no known name (private projects) stay in Other. That
is the intended failure mode: an app nobody could know is shown under "Other" and the user drags it.

## What the classifier does not do
No network, no AI service, no learning from the user. It never moves an app the user has filed (`FiledBy::User`),
and a deleted category sends its apps to "Other".
