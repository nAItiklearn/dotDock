import { memo, type ReactNode } from "react";

/**
 * Line icons the dock needs beyond the shared set, on the same 24-unit grid and stroke as `Icon`.
 * The 3 x 3 dot grid is the App Library's mark: the dot-matrix language in its smallest form.
 */
const SHAPES = {
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  pencil: <path d="M5 19l1-4 9.5-9.5a2.1 2.1 0 0 1 3 3L9 18l-4 1ZM13.5 7.5l3 3" />,
  network: (
    <>
      <path d="M5 18v-3" />
      <path d="M10 18v-6" />
      <path d="M15 18V9" />
      <path d="M20 18V5" />
    </>
  ),
  "network-off": (
    <>
      <path d="M5 18v-3" opacity=".45" />
      <path d="M10 18v-6" opacity=".45" />
      <path d="M15 18V9" opacity=".45" />
      <path d="M20 18V5" opacity=".45" />
      <path d="M4 4l16 16" />
    </>
  ),
  window: (
    <>
      <rect x="4" y="5.5" width="16" height="13" rx="2.5" />
      <path d="M4 9.5h16" />
    </>
  ),
  stack: (
    <>
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.8" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.8" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="1.8" />
      <rect x="13.5" y="13.5" width="6" height="6" rx="1.8" />
    </>
  ),
  tile: (
    <>
      <rect x="3.5" y="7" width="17" height="10" rx="5" />
      <circle cx="8.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  folder: <path d="M4 7.5a2 2 0 0 1 2-2h3.5l2 2.5H18a2 2 0 0 1 2 2V16.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />,
} as const satisfies Record<string, ReactNode>;

export type DockIconName = keyof typeof SHAPES;

export const DockIcon = memo(function DockIcon({ name, className }: { readonly name: DockIconName; readonly className?: string }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {SHAPES[name]}
    </svg>
  );
});

/** Battery outline with a level fill; the bolt shows while charging. */
export const BatteryIcon = memo(function BatteryIcon({ percent, charging }: { readonly percent: number; readonly charging: boolean }) {
  const fill = Math.min(1, Math.max(0, percent / 100));
  return (
    <svg className="icon battery-icon" viewBox="0 0 28 16" fill="none" aria-hidden="true">
      <rect x="1" y="1.5" width="22" height="13" rx="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M25.5 6v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="3.6" y="4.1" width={Math.max(0, 17.8 * fill)} height="7.8" rx="2" fill="currentColor" />
      {charging ? <path d="M13 3.4 8.8 8.6h3.2L11 12.6l4.4-5.4h-3.3Z" fill="var(--surface-2)" stroke="var(--surface-2)" strokeWidth=".6" strokeLinejoin="round" /> : null}
    </svg>
  );
});

const GRID_DOTS = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ row, col })));
const GRID_CENTRE = 1;

/** The App Library mark: nine dots, the middle one in the accent colour. */
export const LibraryMark = memo(function LibraryMark() {
  return (
    <svg className="dot-grid" viewBox="0 0 24 24" aria-hidden="true">
      {GRID_DOTS.map(({ row, col }) => (
        <circle
          key={`${row}-${col}`}
          cx={5 + col * 7}
          cy={5 + row * 7}
          r={row === GRID_CENTRE && col === GRID_CENTRE ? 2.4 : 2}
          fill={row === GRID_CENTRE && col === GRID_CENTRE ? "var(--accent)" : "currentColor"}
        />
      ))}
    </svg>
  );
});
