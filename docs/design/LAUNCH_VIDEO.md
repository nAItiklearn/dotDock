# Launch video plan (milestone D7, with the release)

Owner request (2026-11-20): a video showing the home screen, the features and how smooth everything is.
Recorded from the real app on this laptop, never mocked up. Shown on the website (`website/src/video.ts`
already has a slot) and in the release notes.

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
