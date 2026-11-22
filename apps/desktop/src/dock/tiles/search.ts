/** The web search tile: which engine, and the address a query opens. Nothing leaves the dock until Enter. */
export const ENGINES = ["duckduckgo", "google", "bing", "ecosia", "brave"] as const;
export type Engine = (typeof ENGINES)[number];

const TEMPLATE: Readonly<Record<Engine, string>> = {
  duckduckgo: "https://duckduckgo.com/?q=",
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  ecosia: "https://www.ecosia.org/search?q=",
  brave: "https://search.brave.com/search?q=",
};

export const ENGINE_NAME: Readonly<Record<Engine, string>> = {
  duckduckgo: "DuckDuckGo",
  google: "Google",
  bing: "Bing",
  ecosia: "Ecosia",
  brave: "Brave Search",
};

export const DEFAULT_ENGINE: Engine = "duckduckgo";

export const isEngine = (value: unknown): value is Engine => typeof value === "string" && (ENGINES as readonly string[]).includes(value);

/** A host name with a dot, typed without spaces: "github.com", "example.org/path", "http://site.dev:8080". */
const ADDRESS = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;
const HAS_SCHEME = /^https?:\/\//i;

/** Endings of file names people type, which look like a domain but are not one: "notes.txt" is searched for. */
const FILE_ENDINGS = new Set(["txt", "exe", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "gif", "svg", "zip", "rar", "md", "js", "ts", "json", "csv", "mp3", "mp4", "mov", "wav", "dll", "msi", "bat", "ps1", "py", "log", "ini", "cfg"]);

/** True when Enter opens the typed site instead of searching for the words. */
export function isAddressQuery(query: string): boolean {
  const text = query.trim();
  if (!ADDRESS.test(text)) return false;
  if (HAS_SCHEME.test(text) || /[/?#:]/.test(text.replace(HAS_SCHEME, ""))) return true;
  return !FILE_ENDINGS.has(text.slice(text.lastIndexOf(".") + 1).toLowerCase());
}

/**
 * Where Enter goes: a typed address opens that site (over https unless it said http), and anything else is searched
 * with the chosen engine. Null for an empty field.
 */
export function searchTarget(engine: Engine, query: string): string | null {
  const text = query.trim();
  if (text === "") return null;
  if (isAddressQuery(text)) return HAS_SCHEME.test(text) ? text : `https://${text}`;
  return `${TEMPLATE[engine]}${encodeURIComponent(text)}`;
}

/** Only web addresses leave the dock: the opener never receives a file, script or app address. */
export const isWebAddress = (url: string): boolean => /^https?:\/\/\S+$/i.test(url);
