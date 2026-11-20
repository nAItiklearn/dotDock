import { memo, type ReactNode } from "react";

/**
 * Crisp line icons for controls and small marks, on a 24-unit grid.
 * Dot-matrix pictograms (`DotIcon`) are for large illustrations; below roughly 28 px their dots blur,
 * so anything button-sized uses these instead.
 */
const SHAPES = {
  play: <path d="M8 5.5v13l11-6.5Z" fill="currentColor" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  next: (
    <>
      <path d="M6 6v12l9-6Z" fill="currentColor" />
      <path d="M18.5 6v12" />
    </>
  ),
  previous: (
    <>
      <path d="M18 6v12l-9-6Z" fill="currentColor" />
      <path d="M5.5 6v12" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  cross: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  "chevron-left": <path d="M14.5 5.5L8 12l6.5 6.5" />,
  "chevron-right": <path d="M9.5 5.5L16 12l-6.5 6.5" />,
  reset: <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v4.5H9" />,
  pin: <path d="M9 4h6M10 4v6l-3 4.5h10L14 10V4M12 14.5V20" />,
  grip: (
    <>
      <circle cx="9" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  bolt: <path d="M13 3.5 6 14h5.5L10.5 20.5 18 10h-5.5Z" fill="currentColor" />,
  image: (
    <>
      <rect x="4" y="5.5" width="16" height="13" rx="2.5" />
      <circle cx="15.5" cy="9.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M4.5 16.5l5-5 4.5 4.5 2-2 3.5 3.5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  "mic-off": <path d="M9 7.5V6.5a3 3 0 0 1 6 0v5M9 10v1.5a3 3 0 0 0 4.6 2.5M5.5 11.5a6.5 6.5 0 0 0 10.6 5M18.3 13a6.5 6.5 0 0 0 .2-1.5M12 18v2.5M4 4l16 16" />,
  volume: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  "volume-off": (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  phone: <path d="M6.5 4h3l1.5 4-2 1.5a10 10 0 0 0 5.5 5.5L16 13l4 1.5v3a2 2 0 0 1-2 2A14 14 0 0 1 4.5 6a2 2 0 0 1 2-2Z" />,
  video: (
    <>
      <rect x="3.5" y="6.5" width="12" height="11" rx="2.5" />
      <path d="M15.5 10.5l5-3v9l-5-3Z" />
    </>
  ),
  message: <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" />,
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  flag: <path d="M6 20.5V4.5M6 5h11l-2 3.5 2 3.5H6" />,
  trash: <path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 12.5h8L17 7" />,
  wifi: (
    <>
      <path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.8a8 8 0 0 1 11 0M9.4 16a4 4 0 0 1 5.2 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  bluetooth: <path d="M7 7.5l10 9-5 4v-17l5 4-10 9" />,
  moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M6 18l1.4-1.4M16.6 7.4L18 6" />
    </>
  ),
  bell: <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5Zm4 3.5a1.8 1.8 0 0 0 3 0" />,
  note: (
    <>
      <path d="M6 4.5h9l3.5 3.5v11.5H6Z" />
      <path d="M9 11h6M9 14.5h6" />
    </>
  ),
  picker: <path d="M14.5 5.5l4 4M13 7l4 4-8 8H5v-4ZM16 4.5l3.5 3.5" />,
  swap: <path d="M7 8h11M15 5l3 3-3 3M17 16H6M9 13l-3 3 3 3" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="10" height="11" rx="2" />
      <path d="M15.5 5.5h-8a2 2 0 0 0-2 2v9" />
    </>
  ),
  "arrow-down": <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />,
  "arrow-up": <path d="M12 19V5M6.5 10.5L12 5l5.5 5.5" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c3 3.2 3 13.8 0 17M12 3.5c-3 3.2-3 13.8 0 17" />
    </>
  ),
  move: <path d="M12 4v16M4 12h16M12 4l-2.5 2.5M12 4l2.5 2.5M12 20l-2.5-2.5M12 20l2.5-2.5M4 12l2.5-2.5M4 12l2.5 2.5M20 12l-2.5-2.5M20 12l-2.5 2.5" />,
} as const satisfies Record<string, ReactNode>;

export type IconName = keyof typeof SHAPES;

export interface IconProps {
  readonly name: IconName;
  readonly className?: string;
}

/** Sized by CSS (`height`), coloured by `currentColor`. */
export const Icon = memo(function Icon({ name, className }: IconProps) {
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
