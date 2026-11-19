export interface NoticeSection {
  readonly title: string;
  readonly items: readonly string[];
}

export interface ParsedNotices {
  /** Paragraphs before the first section. */
  readonly intro: readonly string[];
  readonly sections: readonly NoticeSection[];
  /** Paragraphs after the closing rule, e.g. the "not affiliated" line. */
  readonly footer: readonly string[];
}

/**
 * Reads the small subset of Markdown THIRD_PARTY_NOTICES.md uses: a title, `##` sections of `-` bullets,
 * plain paragraphs, and a `---` rule before the closing note. The file stays the single source of truth;
 * About only lays it out.
 */
export function parseNotices(markdown: string): ParsedNotices {
  const intro: string[] = [];
  const footer: string[] = [];
  const sections: { title: string; items: string[] }[] = [];
  let afterRule = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("# ")) continue;
    if (line === "---") {
      afterRule = true;
      continue;
    }
    if (afterRule) {
      footer.push(line);
    } else if (line.startsWith("## ")) {
      sections.push({ title: line.slice(3).trim(), items: [] });
    } else if (line.startsWith("- ")) {
      sections.at(-1)?.items.push(line.slice(2).trim());
    } else if (sections.length === 0) {
      intro.push(line);
    } else {
      sections.at(-1)?.items.push(line);
    }
  }
  return { intro, sections, footer };
}

export type InlinePart = { readonly kind: "text" | "code"; readonly text: string } | { readonly kind: "link"; readonly text: string; readonly href: string };

const INLINE = /(`[^`]+`|https?:\/\/[^\s)<>,]+[^\s)<>,.])/g;

/** Splits a line into text, `code` and bare links. Nothing is ever rendered as HTML. */
export function splitInline(line: string): readonly InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index;
    if (at > last) parts.push({ kind: "text", text: line.slice(last, at) });
    parts.push(token.startsWith("`") ? { kind: "code", text: token.slice(1, -1) } : { kind: "link", text: token, href: token });
    last = at + token.length;
  }
  if (last < line.length) parts.push({ kind: "text", text: line.slice(last) });
  return parts;
}
