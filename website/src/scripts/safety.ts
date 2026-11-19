/**
 * "One click back to stock Windows" demo. It illustrates what the app's Settings switch does;
 * it changes nothing on the visitor's machine. State lives in data-state on the container and the
 * rest is CSS, so reduced-motion needs no special case here.
 */
const root = document.querySelector<HTMLElement>("[data-safety]");

if (root) {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-safety-set]")];
  const status = root.querySelector<HTMLElement>("[data-safety-status]");
  const product = root.dataset["product"] ?? "";
  const messages: Record<string, string> = {
    on: `Desktop switched to the ${product} desktop. Widgets and wallpaper are back.`,
    stock: "Desktop switched to Windows. Wallpaper and icons restored, autostart removed, startup delay put back.",
  };

  const set = (state: string): void => {
    root.dataset["state"] = state;
    for (const b of buttons) {
      const on = b.dataset["safetySet"] === state;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (status) status.textContent = messages[state] ?? "";
  };

  for (const b of buttons) {
    b.addEventListener("click", () => set(b.dataset["safetySet"] ?? "on"));
  }
  root.addEventListener("keydown", (e) => {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !back) return;
    const at = buttons.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = buttons[(at + (forward ? 1 : buttons.length - 1)) % buttons.length];
    next?.focus();
    next?.click();
  });
}
