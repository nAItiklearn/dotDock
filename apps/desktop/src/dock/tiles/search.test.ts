import { describe, expect, it } from "vitest";
import { ENGINES, isEngine, isWebAddress, searchTarget } from "./search";

describe("web search", () => {
  it("searches with the chosen engine, the query escaped", () => {
    expect(searchTarget("duckduckgo", "dot matrix fonts")).toBe("https://duckduckgo.com/?q=dot%20matrix%20fonts");
    expect(searchTarget("google", "a&b=c")).toBe("https://www.google.com/search?q=a%26b%3Dc");
    expect(searchTarget("bing", "  café  ")).toBe("https://www.bing.com/search?q=caf%C3%A9");
  });

  it("opens a typed address directly, over https", () => {
    expect(searchTarget("google", "github.com")).toBe("https://github.com");
    expect(searchTarget("google", "example.org/docs?a=1")).toBe("https://example.org/docs?a=1");
    expect(searchTarget("google", "http://site.dev:8080")).toBe("http://site.dev:8080");
  });

  it("does not take a sentence with a full stop for an address", () => {
    expect(searchTarget("ecosia", "what is 3.5 km")).toBe("https://www.ecosia.org/search?q=what%20is%203.5%20km");
  });

  it("searches for a file name rather than opening it as a site", () => {
    expect(searchTarget("google", "notes.txt")).toBe("https://www.google.com/search?q=notes.txt");
    expect(searchTarget("google", "setup.exe")).toBe("https://www.google.com/search?q=setup.exe");
  });

  it("does nothing for an empty field", () => {
    expect(searchTarget("brave", "   ")).toBeNull();
  });

  it("knows its engines, and only lets web addresses out", () => {
    for (const e of ENGINES) expect(isEngine(e)).toBe(true);
    expect(isEngine("yahoo")).toBe(false);
    expect(isWebAddress("https://duckduckgo.com/?q=x")).toBe(true);
    expect(isWebAddress("file:///C:/Windows")).toBe(false);
    expect(isWebAddress("javascript:alert(1)")).toBe(false);
  });
});
