/**
 * Visual effects tier. "full" adds backdrop blur and long soft shadows on the panels; "lite" draws every
 * surface solid with tight shadows and no filters. Layout and motion are identical in both, and the bar itself
 * is solid in both, so a cheap laptop gets the same dock. The choice is one attribute on the root.
 */
export type Effects = "full" | "lite";
export type EffectsChoice = "auto" | Effects;

export const EFFECTS_STORAGE_KEY = "dotdock.dock.effects";

/** Machines with this many logical cores or fewer, or this much memory (GB) or less, start in lite. */
export const LITE_MAX_CORES = 4;
export const LITE_MAX_MEMORY_GB = 4;

export interface Capabilities {
  readonly cores: number | null;
  /** `navigator.deviceMemory`: coarse, capped at 8 by the browser. */
  readonly memoryGb: number | null;
  /** The OS asked for less transparency (Windows "Transparency effects" off). */
  readonly reducedTransparency: boolean;
  /** The GPU process runs on a software rasteriser. */
  readonly softwareRendering: boolean;
}

/** The tier for this machine, unless the user chose one. */
export function chooseEffects(choice: EffectsChoice, caps: Capabilities): Effects {
  if (choice !== "auto") return choice;
  if (caps.reducedTransparency || caps.softwareRendering) return "lite";
  if (caps.cores !== null && caps.cores <= LITE_MAX_CORES) return "lite";
  if (caps.memoryGb !== null && caps.memoryGb <= LITE_MAX_MEMORY_GB) return "lite";
  return "full";
}

export function parseChoice(value: string | null): EffectsChoice {
  return value === "full" || value === "lite" ? value : "auto";
}

const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|basic render|software/i;

/** Whether WebGL runs on a software renderer. Asked once at start; a missing context counts as software. */
function usesSoftwareRendering(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return true;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return SOFTWARE_RENDERERS.test(renderer);
  } catch {
    return false;
  }
}

export function readCapabilities(): Capabilities {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    cores: Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : null,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    reducedTransparency: window.matchMedia("(prefers-reduced-transparency: reduce)").matches,
    softwareRendering: usesSoftwareRendering(),
  };
}

/** The saved choice, or the one in the page address (`?effects=lite`) for previews. */
export function readChoice(): EffectsChoice {
  const fromAddress = new URLSearchParams(location.search).get("effects");
  if (fromAddress !== null) return parseChoice(fromAddress);
  try {
    return parseChoice(localStorage.getItem(EFFECTS_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

export function saveChoice(choice: EffectsChoice): void {
  try {
    localStorage.setItem(EFFECTS_STORAGE_KEY, choice);
  } catch {
    // Without storage the choice lasts until the window closes.
  }
}
