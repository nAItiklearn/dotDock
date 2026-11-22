/**
 * User Timing marks for how long a panel takes to appear, readable in a DevTools trace (the Timings track) and by
 * the dev harness. `dock:open` runs from the press that asked for the panel to the first frame that shows it.
 * Three marks per open and nothing at all while idle.
 */
const START = "dock:open:start";
const PAINTED = "dock:open:painted";
const MEASURE = "dock:open";

/** The press that asked for a panel. `inputTime` is the event's own timestamp, so queueing before the handler counts. */
export function markOpenStart(panel: string, inputTime: number): void {
  performance.mark(START, { startTime: inputTime, detail: { panel } });
}

let channel: MessageChannel | null = null;
const waiting: string[] = [];

function afterFrame(panel: string): void {
  if (channel === null) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const name = waiting.shift();
      if (name === undefined) return;
      performance.mark(PAINTED, { detail: { panel: name } });
      try {
        performance.measure(MEASURE, { start: START, end: PAINTED, detail: { panel: name } });
      } catch {
        // No start mark: the panel was opened by something other than a press (a shortcut from the core).
      }
      performance.clearMarks(START);
    };
  }
  waiting.push(panel);
  channel.port2.postMessage(0);
}

/**
 * Call from the panel's layout effect: marks the first frame that includes it. The mark is taken in the task
 * that follows that frame's rAF callbacks, which is after the frame was produced.
 */
export function markOpenPainted(panel: string): void {
  requestAnimationFrame(() => afterFrame(panel));
}
