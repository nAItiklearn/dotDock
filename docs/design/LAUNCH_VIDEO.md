# Launch video plan (milestone D7, with the release)

Three films, each in a horizontal and a vertical cut, all recorded from the real app: **main tour** (about 60 s, home page), **dock** (about 30 s, Features page, dock section) and **notch** (about 30 s, Features page, island section), plus vertical 15 s versions of each for social. The website shows each only when its files exist (`website/public/video/<name>.mp4` and `<name>-poster.webp`, names `tour`, `dock`, `notch`; optional `<name>.vtt` captions); until then no slot is rendered.

Owner request (2026-11-20): a video showing the home screen, the features and how smooth everything is.
Recorded from the real app on this laptop, never mocked up. Shown on the website through `website/src/components/VideoSlot.astro` (hidden until the files exist) and in the release notes.

## Capture
- Real desktop at 1920 x 1080, recorded with ffmpeg `gdigrab` at 60 fps (lossless intermediate), plus
  WebView screencasts for close-ups. Wallpaper Engine off during capture so frames are ours.
- Each shot also records its frame-time trace, so on-screen smoothness claims are measured.
- No personal data on screen: a clean demo profile, sample files with neutral names, no real email or chats.

## Cut (about 60 s, plus a 15 s vertical version for social)
1. Cold boot: sign in, the wallpaper and widgets appear (the startup numbers on screen).
2. Home screen: edit mode, drag, snap, resize, theme switch Obsidian → Paper → Aurum, photo widget.
3. Dock: hover magnification sweep, a category stack opening, the App Library search.
4. Running windows: thumbnails, focus dots, the taskbar gone.
5. Agent Island: a real coding session going from thinking to done.
6. Safety: "Use Windows desktop" and everything back in one click.
7. End card: the logo, "free and open source", the website address.

## Rules
- Music only from a CC0 or own source, recorded in THIRD_PARTY_NOTICES.md.
- Every shot passes the same rubric (4.5) as the product.
- Built with ffmpeg; the edit script lives in `tools/video/` so it can be re-cut after updates.

## The three cuts (owner request 2026-11-20)
| File stem | Where it plays | Horizontal | Vertical | What it shows |
|---|---|---|---|---|
| `tour` | Home page, under the hero | about 60 s | 15 s | The cut above: boot, home screen, dock, running windows, island, safety, end card |
| `dock` | Features, dock section | about 30 s | 15 s | Hover magnification sweep, a category stack opening, App Library search, right-click menu, window preview, edit mode, a live tile popover |
| `notch` | Features, island section | about 30 s | 15 s | A real coding session from thinking to done in Claude Code, then Codex and one more agent; Needs-you prompt; click to focus the terminal |

Encode H.264 MP4, 1080p (720p for the vertical cut), no audio on the site versions, 1.5 MB per 10 s as a ceiling; poster frame as WebP at the video's size. The site uses `preload="none"`, so a visitor downloads nothing until they press play.
