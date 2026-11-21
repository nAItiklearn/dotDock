# App catalogue: what the dock leaves out, and why

The dock and its App Library show only apps that really work for this user. The catalogue reads the two Start
menu folders and the shell's AppsFolder, then drops every entry that is not a working app. This list is the output
of `cargo run -p dotdock-dock --example catalogue_probe -- --removed` on the owner's laptop, 2026-11-21. Each row
is one entry the scan found; an entry listed in both the Start menu and the AppsFolder appears once.

Rules (all in `apps/desktop/src-tauri/dock/src/catalogue/`, each with a unit test):
- **Dead shortcut / dead entry**: the program the shortcut or the AppsFolder item points at no longer exists.
- **Folder**: the entry opens a folder, not an app.
- **Uninstaller, readme, documentation, licence, release notes, help or web link, tutorial, troubleshooter,
  set-up step**: named or shaped like one (name words, leading words, an `unins*` program, `msiexec /x`, a
  document or `http(s)` target).
- **Duplicate**: two entries with one name are one app for the user; the first (Start menu) is kept and takes the
  other's package and publisher.
- **Mode of another app**: an entry named after another app plus more words that starts the same program
  (`Vim Diff`, `Windows PowerShell (x86)`); it is reachable from the app itself.

| Entry | Why it is not on the dock |
|---|---|
| Backup | a folder, not an app |
| CmAct | a folder, not an app |
| Documentation | a folder, not an app |
| Logs | a folder, not an app |
| gVim Diff | a mode of gvim, opened from it |
| gVim Easy | a mode of gvim, opened from it |
| gVim Read-only | a mode of gvim, opened from it |
| MySQL 8.0 Command Line Client - Unicode | a mode of mysql 8 0 command line client, opened from it |
| Vim Diff | a mode of vim, opened from it |
| Vim Read-only | a mode of vim, opened from it |
| Windows PowerShell ISE 5.1 (x86) | a mode of windows powershell ise 5 1, opened from it |
| Windows PowerShell (x86) | a mode of windows powershell, opened from it |
| Calculator Tools 10.0 | dead entry: its program is gone |
| CLion 2026.2.2 | dead entry: its program is gone |
| Comet | dead entry: its program is gone |
| Cursor | dead entry: its program is gone |
| Drawing Sheet Editor 10.0 | dead entry: its program is gone |
| Gerber Viewer 10.0 | dead entry: its program is gone |
| Hermes | dead entry: its program is gone |
| IBM Bob | dead entry: its program is gone |
| Image Converter 10.0 | dead entry: its program is gone |
| KiCad 10.0 | dead entry: its program is gone |
| MongoDB Compass | dead entry: its program is gone |
| PCB Editor 10.0 (standalone) | dead entry: its program is gone |
| PCSX2 | dead entry: its program is gone |
| PPSSPP | dead entry: its program is gone |
| Report a Problem with Unity | dead entry: its program is gone |
| Resident Evil 2 | dead entry: its program is gone |
| Resident Evil 2 (Settings) | dead entry: its program is gone |
| Resident Evil 3 | dead entry: its program is gone |
| Resident Evil 4 | dead entry: its program is gone |
| Roblox Player | dead entry: its program is gone |
| Roblox Studio | dead entry: its program is gone |
| Schematic Editor 10.0 (standalone) | dead entry: its program is gone |
| TLauncher | dead entry: its program is gone |
| Unity | dead entry: its program is gone |
| Unity Hub | dead entry: its program is gone |
| Windsurf | dead entry: its program is gone |
| Calculator Tools 10.0 | dead shortcut: its program is gone |
| CLion 2026.2.2 | dead shortcut: its program is gone |
| Drawing Sheet Editor 10.0 | dead shortcut: its program is gone |
| Gerber Viewer 10.0 | dead shortcut: its program is gone |
| Image Converter 10.0 | dead shortcut: its program is gone |
| PCB Editor 10.0 (standalone) | dead shortcut: its program is gone |
| PCSX2 | dead shortcut: its program is gone |
| PPSSPP | dead shortcut: its program is gone |
| Report a Problem with Unity | dead shortcut: its program is gone |
| Resident Evil 2 | dead shortcut: its program is gone |
| Resident Evil 2 (Settings) | dead shortcut: its program is gone |
| Resident Evil 3 | dead shortcut: its program is gone |
| Resident Evil 4 | dead shortcut: its program is gone |
| Roblox Player | dead shortcut: its program is gone |
| Roblox Studio | dead shortcut: its program is gone |
| Schematic Editor 10.0 (standalone) | dead shortcut: its program is gone |
| Tiled | dead shortcut: its program is gone |
| TLauncher | dead shortcut: its program is gone |
| Uninstall PCSX2 | dead shortcut: its program is gone |
| Unity | dead shortcut: its program is gone |
| WSL Settings | dead shortcut: its program is gone |
| Python 3.13 Manuals (64-bit) | document, not a program |
| Console RAR manual | documentation |
| LFS Manual | documentation |
| Node.js documentation | documentation |
| Python 3.13 Module Docs (64-bit) | documentation |
| Reference Documentation | documentation |
| Add a new TAP virtual ethernet adapter | driver set-up step |
| Delete ALL TAP virtual ethernet adapters | driver set-up step |
| Cursor | duplicate of an app with the same name |
| Photos | duplicate of an app with the same name |
| Unity Hub | duplicate of an app with the same name |
| 7-Zip Help | help link |
| CodeMeter User Help | help link |
| Get Help | help link |
| Help | help link |
| Help File | help link |
| Help File (PDF) | help link |
| WinRAR help | help link |
| README | readme |
| View README | readme |
| Git Release Notes | release notes |
| Unity Release Notes | release notes |
| Install Additional Tools for Node.js | set-up step |
| Backup | shortcut to a folder |
| CmAct | shortcut to a folder |
| Documentation | shortcut to a folder |
| Logs | shortcut to a folder |
| LFS Manual | shortcut with no target |
| Power Automate Troubleshooter | troubleshooter |
| Vim tutor | tutorial |
| Uninstall | uninstaller |
| Uninstall Free Download Manager | uninstaller |
| Uninstall KMPlayer | uninstaller |
| Uninstall LFS | uninstaller |
| Uninstall Node.js | uninstaller |
| Uninstall qBittorrent | uninstaller |
| Uninstall WizTree | uninstaller |
| Uninstall Zoom Workplace | uninstaller |
| Git FAQs (Frequently Asked Questions) | web link |
| KMPlayer Home Page | web link |
| Lenovo Subscription Marketplace | web link |
| Node.js website | web link |
| Steam Support Center | web link |
| Vim Online | web link |
| Website | web link |

Kept: 197 apps. Left out: 104 entries.
