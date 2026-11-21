import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { holdKeyboard } from "../lib/native/keyboardFocus";
import { Icon } from "../lib/ui/Icon";
import type { MenuItem } from "./directActions";

/** Glyph size in menu rows; the empty icon column of unchecked choices uses the same width. */
const MENU_ICON_SIZE = 16;

export interface WidgetMenuProps {
  /** Where the right-click happened, in viewport pixels. */
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly onClose: () => void;
}

/**
 * The right-click menu on a widget. It opens at the pointer, nudged inside the screen, takes the keyboard
 * while open (arrows, Enter, Esc) and closes when the user clicks anywhere else, including another app.
 */
export function WidgetMenu({ x, y, label, items, onClose }: WidgetMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Measured once before paint, so the menu never shows hanging off the screen edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = Number.parseFloat(getComputedStyle(el).getPropertyValue("--menu-margin")) || 0;
    const maxX = window.innerWidth - el.offsetWidth - margin;
    const maxY = window.innerHeight - el.offsetHeight - margin;
    setPos({ x: Math.max(margin, Math.min(x, maxX)), y: Math.max(margin, Math.min(y, maxY)) });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    holdKeyboard("menu", true);
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    // Clicking anything outside the overlay (Explorer, an app) takes focus away from this window.
    window.addEventListener("blur", onClose);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      holdKeyboard("menu", false);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div
      ref={ref}
      className="widget-menu"
      data-hit
      role="menu"
      aria-label={label}
      data-tx={pos.x}
      data-ty={pos.y}
      style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role={item.checked === undefined ? "menuitem" : "menuitemradio"}
          aria-checked={item.checked}
          className={[
            "widget-menu__item",
            item.tone === "danger" ? "widget-menu__item--danger" : "",
            item.separated ? "widget-menu__item--separated" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          {item.icon ? <Icon name={item.icon} size={MENU_ICON_SIZE} /> : <span className="widget-menu__blank" aria-hidden="true" />}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
