/** Questions shown on the FAQ page; the first few also appear on the home page. */
import { DISCLAIMER, PRODUCT_NAME, ROUTES } from "./brand";

export interface FaqItem {
  readonly id: string;
  readonly q: string;
  readonly a: readonly string[];
  /** A command shown in a copyable block under the answer. */
  readonly code?: string;
  readonly link?: { readonly href: string; readonly label: string };
}

export const RESTORE_COMMAND = ".\\tools\\restore-windows.ps1 -DryRun";

export const FAQ: readonly FaqItem[] = [
  {
    id: "safe",
    q: "Is it safe to try?",
    a: [
      `Yes, and you can undo it. Before changing anything, ${PRODUCT_NAME} snapshots your wallpaper and desktop settings. Turning off the "dotDock theme" switch at the end of Settings puts them back, and uninstalling does the same.`,
    ],
  },
  {
    id: "restore",
    q: "What if the app will not start?",
    a: [
      "The repository includes a standalone PowerShell script that restores your wallpaper, desktop icons, autostart entry and startup-delay setting without the app. Run it from a checkout of the repository. With -DryRun it only prints what it would change.",
    ],
    code: RESTORE_COMMAND,
  },
  {
    id: "explorer",
    q: "Does it replace Explorer or the Windows shell?",
    a: [
      "No. Explorer keeps running and the Start menu, notification centre and system tray stay Windows's own. The widget layer is a window that sits on the desktop, under your other windows.",
    ],
  },
  {
    id: "admin",
    q: "Does it need administrator rights?",
    a: ["No. It installs per user and only changes settings for your own account. It does not write to system-wide locations."],
  },
  {
    id: "startup",
    q: "How quickly does it appear at sign-in?",
    a: [
      "Your wallpaper is set in Windows itself, so it is there from the first frame. On the author's laptop the widgets were on screen about 0.7 to 1.0 seconds after the app started (three runs of a development build). Windows draws its own desktop first and the sign-in screen is Windows's, so we do not promise more than that.",
    ],
    link: { href: `${ROUTES.home}#startup`, label: "See the measurements" },
  },
  {
    id: "versions",
    q: "Which versions of Windows does it support?",
    a: ["Windows 10 22H2 and Windows 11. It needs the Microsoft Edge WebView2 runtime, which comes with Windows 11 and current Windows 10."],
  },
  {
    id: "affiliation",
    q: "Is it affiliated with Nothing?",
    a: [
      `No. ${DISCLAIMER} The dot-matrix look is drawn from scratch: the widgets, wallpapers and glyphs are original, and the fonts are open-source.`,
    ],
  },
  {
    id: "cost",
    q: "What does it cost, and who owns my data?",
    a: ["It is free and open source under GPL-3.0-or-later. Your data stays on your PC: there is no account and no telemetry."],
    link: { href: ROUTES.privacy, label: "Read the privacy page" },
  },
];
