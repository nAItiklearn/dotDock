import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "../providers/bridge";

/**
 * Commands that cross windows: Settings → overlay, tray and global hotkeys → overlay.
 * In the desktop app they travel as a Tauri event every window can hear (the core emits the same
 * event for hotkeys and tray items); in a plain browser they travel over a BroadcastChannel.
 */
export type BusCommand =
  | { readonly type: "edit-mode"; readonly on: boolean | "toggle" }
  | { readonly type: "next-profile" };

export const BUS_EVENT = "dotdock://command";
const BROADCAST_CHANNEL = "dotdock";

export function isBusCommand(value: unknown): value is BusCommand {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["type"] === "next-profile") return true;
  return v["type"] === "edit-mode" && (typeof v["on"] === "boolean" || v["on"] === "toggle");
}

export interface CommandBus {
  send(command: BusCommand): void;
  subscribe(handler: (command: BusCommand) => void): () => void;
}

function tauriBus(): CommandBus {
  return {
    send: (command) => {
      emit(BUS_EVENT, command).catch((err: unknown) => console.error("bus send failed", err));
    },
    subscribe: (handler) => {
      const pending = listen<unknown>(BUS_EVENT, (e) => {
        if (isBusCommand(e.payload)) handler(e.payload);
      });
      return () => void pending.then((off) => off());
    },
  };
}

function browserBus(): CommandBus {
  if (typeof BroadcastChannel === "undefined") return { send: () => undefined, subscribe: () => () => undefined };
  const sender = new BroadcastChannel(BROADCAST_CHANNEL);
  return {
    send: (command) => sender.postMessage(command),
    subscribe: (handler) => {
      const receiver = new BroadcastChannel(BROADCAST_CHANNEL);
      receiver.onmessage = (e: MessageEvent<unknown>) => {
        if (isBusCommand(e.data)) handler(e.data);
      };
      return () => receiver.close();
    },
  };
}

export function createCommandBus(): CommandBus {
  return isTauri() ? tauriBus() : browserBus();
}
