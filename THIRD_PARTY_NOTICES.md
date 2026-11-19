# Third-party notices

Every dependency, font, sound and image is listed here with its licence. Nothing is added without an entry.

## Design references (not shipped, not in the repository)
- Colour values are taken from the Omarchy NThing theme by Ninnix (MIT), https://github.com/Ninnix/omarchy-nthing-theme. Hex colours are facts, not copyrightable assets; no files from that repository are included.

## Agent Island: design and protocol derived from Agent Island (MIT)

The Agent Island feature (`apps/desktop/src-tauri/island/`, `island-hook/`, `apps/desktop/src/island/`) is a Windows port of the design and protocol of **Agent Island** by Jean, https://github.com/1413jean/agent-island (MIT, Swift/macOS). No source files, art or sounds were copied; the Rust and TypeScript code is written from scratch. The following behaviour is closely derived from it, so its licence notice is kept:

- the per-session state-file protocol and which hook events feed it,
- classification of interruptions, usage limits and API errors from the Claude Code transcript,
- per-turn token counting de-duplicated by message id,
- the mapping of Codex rollout log events to session states,
- the Connect / Disconnect rule of adding and removing only the app's own hook entries after a backup.

```
MIT License

Copyright (c) 2026 Jean

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Not reused from Agent Island: its cat and orb artwork, its sounds (UI SFX, CC0) and the Sparkle updater. The island's dot-matrix state icons and its three chimes are original; the chimes are synthesised at run time and need no audio files.

## Dependencies added for Agent Island

| Crate | Used for | Licence |
| --- | --- | --- |
| `notify` 8 (and `notify-types`) | file-system watcher for the session folder and logs | CC0-1.0 (`notify`), MIT OR Apache-2.0 (`notify-types`) |
| `tempfile` (dev only) | temporary folders in unit tests | MIT OR Apache-2.0 |
| `walkdir`, `same-file`, `winapi-util` (via `notify`) | directory traversal helpers | Unlicense OR MIT |

`serde`, `serde_json`, `thiserror` and `windows` are already used by the shell crate and are unchanged. `serde_json` is built with its `preserve_order` feature so Connect keeps the key order of the user's `settings.json`.

## Dependencies
Other dependencies are not yet listed here.

---
Inspired by Nothing OS. Not affiliated with or endorsed by Nothing Technology Limited.
