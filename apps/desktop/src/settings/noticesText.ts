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

/** The cells of a Markdown table row, or null when the line is not one. */
function tableCells(line: string): string[] | null {
  if (!line.startsWith("|") || !line.endsWith("|")) return null;
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

const isRuleRow = (cells: readonly string[]): boolean => cells.every((cell) => /^:?-{3,}:?$/.test(cell));

/**
 * Reads the subset of Markdown THIRD_PARTY_NOTICES.md uses: a title, `##` and `###` sections of `-` bullets
 * (a bullet may wrap onto the next lines), tables (one item per row, "first cell: the others"; the header row
 * is dropped), plain paragraphs, and a `---` rule before the closing note. The file stays the single source of
 * truth; About only lays it out.
 */
export function parseNotices(markdown: string): ParsedNotices {
  const intro: string[] = [];
  const footer: string[] = [];
  const sections: { title: string; items: string[] }[] = [];
  let afterRule = false;
  /** The previous line was part of a bullet, so a plain line right after it continues that bullet. */
  let inBullet = false;
  const lines = markdown.split(/\r?\n/).map((raw) => raw.trim());
  lines.forEach((line, index) => {
    if (line === "" || line.startsWith("# ")) {
      inBullet = false;
      return;
    }
    if (line === "---") {
      afterRule = true;
      inBullet = false;
      return;
    }
    if (afterRule) {
      footer.push(line);
      return;
    }
    const heading = /^#{2,3} (.*)$/.exec(line);
    if (heading) {
      sections.push({ title: (heading[1] as string).trim(), items: [] });
      inBullet = false;
      return;
    }
    const cells = tableCells(line);
    if (cells) {
      inBullet = false;
      if (isRuleRow(cells)) return;
      const next = tableCells(lines[index + 1] ?? "");
      // A header row is the one right above the rule row.
      if (next !== null && isRuleRow(next)) return;
      const [first = "", ...rest] = cells.filter((cell) => cell !== "");
      sections.at(-1)?.items.push(rest.length > 0 ? `${first}: ${rest.join(", ")}` : first);
      return;
    }
    const target = sections.length === 0 ? intro : sections.at(-1)?.items;
    if (!target) return;
    if (line.startsWith("- ")) {
      target.push(line.slice(2).trim());
      inBullet = true;
    } else if (inBullet && target.length > 0) {
      target[target.length - 1] = `${target[target.length - 1]} ${line}`;
    } else {
      target.push(line);
    }
  });
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
