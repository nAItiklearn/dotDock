import { describe, expect, it } from "vitest";
import { formatVolume, lapRows, meetingCountdown, nextCountdownChange, stopwatchElapsed, stopwatchText, URGENT_MS } from "./format";

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (startsIn: number, lasts = 30 * MIN) => ({ startsAt: 1_000_000 + startsIn, endsAt: 1_000_000 + startsIn + lasts });
const NOW = 1_000_000;

describe("meetingCountdown", () => {
  it("counts whole minutes, rounding up", () => {
    expect(meetingCountdown(at(12 * MIN), NOW).text).toBe("in 12 min");
    expect(meetingCountdown(at(11 * MIN + 30_000), NOW).text).toBe("in 12 min");
    expect(meetingCountdown(at(MIN), NOW).text).toBe("in 1 min");
  });

  it("says so inside the last minute", () => {
    expect(meetingCountdown(at(30_000), NOW).text).toBe("in under a minute");
  });

  it("switches to hours, dropping empty minutes", () => {
    expect(meetingCountdown(at(HOUR + 5 * MIN), NOW).text).toBe("in 1 h 05");
    expect(meetingCountdown(at(2 * HOUR), NOW).text).toBe("in 2 h");
    expect(meetingCountdown(at(3 * 24 * HOUR + HOUR), NOW).text).toBe("in 3 d");
  });

  it("is urgent from five minutes out until it ends", () => {
    expect(meetingCountdown(at(URGENT_MS), NOW).urgent).toBe(true);
    expect(meetingCountdown(at(URGENT_MS + MIN), NOW).urgent).toBe(false);
    expect(meetingCountdown(at(-5 * MIN), NOW)).toEqual({ phase: "live", text: "Now", urgent: true });
  });

  it("reads as ended once it is over", () => {
    expect(meetingCountdown(at(-HOUR, 30 * MIN), NOW)).toEqual({ phase: "over", text: "Ended", urgent: false });
  });
});

describe("stopwatch", () => {
  it("adds the running segment to the banked time", () => {
    expect(stopwatchElapsed({ running: true, startedAt: 1000, bankedMs: 5000 }, 3500)).toBe(7500);
  });

  it("holds its time when paused or stopped", () => {
    expect(stopwatchElapsed({ running: false, startedAt: null, bankedMs: 5000 }, 99_000)).toBe(5000);
  });

  it("never runs backwards if the clock moved", () => {
    expect(stopwatchElapsed({ running: true, startedAt: 5000, bankedMs: 0 }, 1000)).toBe(0);
  });

  it("writes minutes, seconds and the tenth", () => {
    expect(stopwatchText(247_300)).toEqual({ clock: "04:07", tenth: "3" });
    expect(stopwatchText(0)).toEqual({ clock: "00:00", tenth: "0" });
    expect(stopwatchText(3_904_950)).toEqual({ clock: "1:05:04", tenth: "9" });
  });
});

describe("lapRows", () => {
  it("lists the newest lap first with its split and total", () => {
    const rows = lapRows([10_000, 25_000]);
    expect(rows.map((r) => r.number)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ splitMs: 15_000, totalMs: 25_000, mark: null });
  });

  it("marks the fastest and slowest once there are three laps", () => {
    const rows = lapRows([10_000, 25_000, 33_000, 53_000]);
    const mark = (n: number) => rows.find((r) => r.number === n)?.mark;
    expect(mark(3)).toBe("fastest");
    expect(mark(4)).toBe("slowest");
    expect(mark(1)).toBeNull();
  });

  it("marks nothing when every lap is equal", () => {
    expect(lapRows([5000, 10_000, 15_000]).every((r) => r.mark === null)).toBe(true);
  });

  it("copes with no laps", () => {
    expect(lapRows([])).toEqual([]);
  });
});

describe("nextCountdownChange", () => {
  const meeting = { startsAt: NOW + 3 * HOUR + 17 * MIN + 30_000, endsAt: NOW + 4 * HOUR + 30_000 };
  const words = (at: number): string => meetingCountdown(meeting, at).text;

  it("names the moment the words change: never early, never late", () => {
    // Walk a few hours in odd steps; at every point the text holds until the named moment and differs at it.
    for (let now = NOW - 2 * HOUR; now < meeting.endsAt + MIN; now += 37_123) {
      const next = nextCountdownChange(meeting, now);
      if (next === null) {
        expect(now).toBeGreaterThanOrEqual(meeting.endsAt);
        continue;
      }
      expect(next).toBeGreaterThan(now);
      expect(words(next - 1)).toBe(words(now));
      expect(words(next)).not.toBe(words(now));
    }
  });

  it("holds at the exact minute marks too", () => {
    for (const startsIn of [MIN, 2 * MIN, 5 * MIN, HOUR, HOUR + MIN, 24 * HOUR, 25 * HOUR, 3 * 24 * HOUR]) {
      const m = { startsAt: NOW + startsIn, endsAt: NOW + startsIn + 30 * MIN };
      const next = nextCountdownChange(m, NOW);
      expect(next).not.toBeNull();
      expect(meetingCountdown(m, (next ?? 0) - 1).text).toBe(meetingCountdown(m, NOW).text);
      expect(meetingCountdown(m, next ?? 0).text).not.toBe(meetingCountdown(m, NOW).text);
    }
  });

  it("sleeps until the start inside the last minute, then until the end, then for good", () => {
    const m = { startsAt: NOW + 30_000, endsAt: NOW + 30_000 + 10 * MIN };
    expect(nextCountdownChange(m, NOW)).toBe(m.startsAt);
    expect(nextCountdownChange(m, m.startsAt)).toBe(m.endsAt);
    expect(nextCountdownChange(m, m.endsAt)).toBeNull();
  });
});

describe("formatVolume", () => {
  it("writes millilitres below a litre and litres from one up", () => {
    expect(formatVolume(250, "en")).toBe("250 mL");
    expect(formatVolume(1000, "en")).toBe("1 L");
    expect(formatVolume(1250, "en")).toBe("1.3 L");
    expect(formatVolume(2000, "en")).toBe("2 L");
  });

  it("follows the user's number format", () => {
    expect(formatVolume(1500, "de")).toBe("1,5 l");
  });

  it("rounds a stray fraction of a millilitre", () => {
    expect(formatVolume(249.6, "en")).toBe("250 mL");
  });
});
