import { describe, expect, it } from "vitest";
import notices from "../../../../THIRD_PARTY_NOTICES.md?raw";
import { parseNotices, splitInline } from "./noticesText";

describe("parseNotices", () => {
  const sample = ["# Title", "", "Intro line.", "", "## First", "- one", "- two with `code`", "", "## Second", "None yet.", "", "---", "Closing note."].join("\n");

  it("splits a document into intro, sections and the note after the rule", () => {
    const parsed = parseNotices(sample);
    expect(parsed.intro).toEqual(["Intro line."]);
    expect(parsed.sections).toEqual([
      { title: "First", items: ["one", "two with `code`"] },
      { title: "Second", items: ["None yet."] },
    ]);
    expect(parsed.footer).toEqual(["Closing note."]);
  });

  it("handles Windows line endings and empty input", () => {
    expect(parseNotices(sample.replaceAll("\n", "\r\n")).sections).toHaveLength(2);
    expect(parseNotices("")).toEqual({ intro: [], sections: [], footer: [] });
  });

  it("reads the real notices file, including the not-affiliated disclaimer", () => {
    const parsed = parseNotices(notices);
    expect(parsed.sections.length).toBeGreaterThan(0);
    expect(parsed.footer.join(" ")).toContain("Not affiliated with or endorsed by Nothing Technology Limited");
  });
});

describe("splitInline", () => {
  it("turns code spans and bare links into parts, leaving the rest as text", () => {
    expect(splitInline("see `a.rs` and https://example.com/x.")).toEqual([
      { kind: "text", text: "see " },
      { kind: "code", text: "a.rs" },
      { kind: "text", text: " and " },
      { kind: "link", text: "https://example.com/x", href: "https://example.com/x" },
      { kind: "text", text: "." },
    ]);
  });

  it("never produces markup from angle brackets or scripts", () => {
    const parts = splitInline("<script>alert(1)</script>");
    expect(parts).toEqual([{ kind: "text", text: "<script>alert(1)</script>" }]);
  });

  it("does not link non-http schemes", () => {
    expect(splitInline("javascript:alert(1)")).toEqual([{ kind: "text", text: "javascript:alert(1)" }]);
  });
});
