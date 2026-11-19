import { describe, expect, it } from "vitest";
import { librarySections } from "./librarySections";
import type { Category, DockApp } from "./protocol";

const categories: Category[] = [
  { id: "development", name: null, tone: "blue", order: 1 },
  { id: "media", name: "Listen", tone: "pink", order: 0 },
  { id: "games", name: null, tone: "green", order: 2 },
];

const app = (name: string, category: DockApp["category"], publisher: string | null = null): DockApp => ({
  id: name,
  name,
  category,
  filedBy: "known",
  icon: "",
  publisher,
  firstSeen: 0,
});

const apps = [app("Forge Code", "development"), app("Branch Git", "development"), app("Wave Player", "media"), app("Odd Tool", "custom:deleted")];

describe("librarySections", () => {
  it("lists the categories that have apps in the user's order, and files orphans under Other", () => {
    const sections = librarySections(categories, apps, "");
    expect(sections.map((s) => s.label)).toEqual(["Listen", "Development", "Other"]);
    expect(sections[2]?.apps.map((a) => a.name)).toEqual(["Odd Tool"]);
  });

  it("sorts the apps of a section by name", () => {
    expect(librarySections(categories, apps, "")[1]?.apps.map((a) => a.name)).toEqual(["Branch Git", "Forge Code"]);
  });

  it("keeps only matching apps and drops empty sections while searching", () => {
    const sections = librarySections(categories, apps, "wave");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.apps.map((a) => a.name)).toEqual(["Wave Player"]);
  });

  it("puts the section with the best match first", () => {
    const sections = librarySections(categories, [...apps, app("Gitea", "games")], "git");
    expect(sections[0]?.apps[0]?.name).toBe("Gitea");
  });

  it("matches a category name, so typing 'listen' shows that stack", () => {
    expect(librarySections(categories, apps, "listen").map((s) => s.label)).toEqual(["Listen"]);
  });

  it("returns nothing for no apps or no match", () => {
    expect(librarySections(categories, [], "")).toEqual([]);
    expect(librarySections(categories, apps, "zzzz")).toEqual([]);
  });

  it("searches publishers too", () => {
    const withPublisher = [app("Notebook", "media", "Fabrikam Software")];
    expect(librarySections(categories, withPublisher, "fabrikam")).toHaveLength(1);
  });
});
