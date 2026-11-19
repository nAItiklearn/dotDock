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
