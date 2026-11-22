import { PRODUCT_NAME } from "../lib/branding";
import type { UpdateStatus } from "../lib/native/api";

/** What the Updates row in Settings > About shows, derived from the core's status. */
export type UpdateView =
  | { readonly kind: "preview"; readonly line: string }
  | { readonly kind: "failed"; readonly line: string }
  | { readonly kind: "available"; readonly line: string; readonly version: string }
  | { readonly kind: "current"; readonly line: string }
  | { readonly kind: "unchecked"; readonly line: string };

export interface UpdateViewInput {
  readonly native: boolean;
  readonly status: UpdateStatus | null;
  /** The last request to the core itself failed (not the same as an unreachable service). */
  readonly callFailed: boolean;
  readonly formatTime: (ms: number) => string;
}

export function updateView({ native, status, callFailed, formatTime }: UpdateViewInput): UpdateView {
  if (!native) return { kind: "preview", line: "Updates are delivered through the installed app." };
  if (status?.available) {
    const { version } = status.available;
    return { kind: "available", version, line: `Version ${version} is available. Installing closes ${PRODUCT_NAME} and runs the signed installer.` };
  }
  if (callFailed || status?.failed) return { kind: "failed", line: "Couldn't reach the update service." };
  if (status?.checkedAtMs != null) return { kind: "current", line: `Up to date. Last checked ${formatTime(status.checkedAtMs)}.` };
  return { kind: "unchecked", line: `Checked once, a little after ${PRODUCT_NAME} starts.` };
}
