import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../providers/bridge";
import type { MediaCommand } from "../providers/types";

/**
 * Sends a transport command to the system media session through the core's `media_command`.
 * In a plain browser (design preview) there is no session to control, so nothing is sent.
 */
export function sendMediaCommand(command: MediaCommand): void {
  if (!isTauri()) return;
  invoke("media_command", { command }).catch((err: unknown) => console.error("media command failed", err));
}
