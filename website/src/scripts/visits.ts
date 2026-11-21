/**
 * The visit counter in the footer. A browser that has not counted today sends one POST; every other page view
 * only reads the total. The only thing kept in the browser is the date of the last count. If the counter is not
 * configured or cannot be reached, the line stays hidden: no number is shown that did not come from the server.
 */
const COUNTED_DAY_KEY = "dotdock-visit-day";

async function main(): Promise<void> {
  const line = document.querySelector<HTMLElement>("[data-visits]");
  const number = document.querySelector<HTMLElement>("[data-visits-count]");
  if (!line || !number) return;

  const today = new Date().toISOString().slice(0, 10);
  let counted = false;
  try {
    counted = localStorage.getItem(COUNTED_DAY_KEY) === today;
  } catch {
    // Storage blocked: the page still reads the total, and counts at most once per page load.
  }

  try {
    const response = await fetch("/api/visits", { method: counted ? "GET" : "POST", cache: "no-store" });
    if (!response.ok) return;
    const data: unknown = await response.json();
    const visits = typeof data === "object" && data !== null ? (data as { visits?: unknown }).visits : undefined;
    if (typeof visits !== "number" || !Number.isFinite(visits)) return;
    number.textContent = visits.toLocaleString("en");
    line.hidden = false;
    if (!counted) {
      try {
        localStorage.setItem(COUNTED_DAY_KEY, today);
      } catch {
        // See above.
      }
    }
  } catch {
    // Offline or blocked: leave the counter hidden.
  }
}

void main();
