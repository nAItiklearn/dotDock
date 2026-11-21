/**
 * A short two-note chime synthesised on the spot, so there is no sound asset to license.
 * Browsers only let audio start after a click, so `primeChime` runs from the Start button.
 */
interface Note {
  readonly hz: number;
  /** Seconds after the chime starts. */
  readonly at: number;
}

const NOTES: readonly Note[] = [
  { hz: 659.25, at: 0 },
  { hz: 880, at: 0.16 },
];
const NOTE_SECONDS = 0.9;
const PEAK_GAIN = 0.18;
const ATTACK_SECONDS = 0.02;

let context: AudioContext | null = null;

export function primeChime(): void {
  context ??= new AudioContext();
  void context.resume();
}

/** True when this window may play a chime now: its audio has been started by a click. */
export function chimeReady(): boolean {
  return context?.state === "running";
}

const CLAIM_KEY = "dotdock.chime.claim";

/**
 * Several windows can see the same timer finish (the home screen's widget and the dock's focus tile). The first
 * to claim a finish plays its chime; the others stay quiet. `finish` names the finish, e.g. when the run started.
 */
export function claimChime(finish: string): boolean {
  try {
    if (localStorage.getItem(CLAIM_KEY) === finish) return false;
    localStorage.setItem(CLAIM_KEY, finish);
    return true;
  } catch {
    // No storage to coordinate through: better a doubled chime than none.
    return true;
  }
}

export function playChime(): void {
  const ctx = context;
  if (!ctx || ctx.state !== "running") return;
  const start = ctx.currentTime;
  for (const note of NOTES) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = note.hz;
    gain.gain.setValueAtTime(0, start + note.at);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + note.at + ATTACK_SECONDS);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + NOTE_SECONDS);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + note.at);
    osc.stop(start + note.at + NOTE_SECONDS);
  }
}
