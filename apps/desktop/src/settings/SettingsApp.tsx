import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PRODUCT_NAME } from "../lib/branding";
import { getApp } from "../lib/state/app";
import { useNoticeStore } from "../lib/state/hooks";
import { useAppearance } from "../lib/theme/useAppearance";
import { IconButton, Kbd } from "../lib/ui/controls";
import { Icon } from "../lib/ui/Icon";
import { AboutPage } from "./pages/AboutPage";
import { AppearancePage } from "./pages/AppearancePage";
import { DataPage } from "./pages/DataPage";
import { DisplaysPage } from "./pages/DisplaysPage";
import { HomePage } from "./pages/HomePage";
import { PerformancePage } from "./pages/PerformancePage";
import { ShortcutsPage } from "./pages/ShortcutsPage";
import { StartupPage } from "./pages/StartupPage";
import { WallpapersPage } from "./pages/WallpapersPage";
import { WidgetsPage } from "./pages/WidgetsPage";
import { isPageId, PAGES, pageById, type PageId } from "./pageMeta";
import { searchSettings } from "./searchIndex";
import { UndoBar } from "./ui/undo";
import "./settings.css";

const PAGE_COMPONENTS: Readonly<Record<PageId, () => ReactNode>> = {
  home: () => <HomePage />,
  appearance: () => <AppearancePage />,
  wallpapers: () => <WallpapersPage />,
  widgets: () => <WidgetsPage />,
  startup: () => <StartupPage />,
  displays: () => <DisplaysPage />,
  performance: () => <PerformancePage />,
  shortcuts: () => <ShortcutsPage />,
  data: () => <DataPage />,
  about: () => <AboutPage />,
};

const FLASH_MS = 1800;
/** Pages fill in asynchronously (profile documents, native reads); retry the scroll target for this long. */
const FOCUS_RETRY_MS = 1200;
const FOCUS_RETRY_STEP_MS = 80;
const FOCUSABLE = "button, input, select, a[href], [tabindex]:not([tabindex='-1'])";

interface Route {
  readonly page: PageId;
  readonly focus: string | null;
}

function parseHash(hash: string): Route {
  const match = /^#\/([a-z]+)(?:\?focus=([\w-]+))?/.exec(hash);
  const id = match?.[1];
  return { page: id && isPageId(id) ? id : "home", focus: match?.[2] ?? null };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** Scrolls to a setting found by search, flashes it so the eye lands there, and moves focus into it. */
function useFocusSetting(route: Route, content: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!route.focus) return undefined;
    const started = performance.now();
    let timer = 0;
    const attempt = (): void => {
      const target = content.current?.querySelector<HTMLElement>(`[data-setting-id="${route.focus}"]`);
      if (!target) {
        if (performance.now() - started < FOCUS_RETRY_MS) timer = window.setTimeout(attempt, FOCUS_RETRY_STEP_MS);
        return;
      }
      target.scrollIntoView({ block: "center" });
      target.classList.add("is-flash");
      window.setTimeout(() => target.classList.remove("is-flash"), FLASH_MS);
      target.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
    };
    attempt();
    return () => window.clearTimeout(timer);
  }, [route.page, route.focus, content]);
}

function Notices() {
  const notices = useNoticeStore((s) => s.notices);
  if (notices.length === 0) return null;
  return (
    <div className="notices" role="region" aria-label="Notices">
      {notices.map((n) => (
        <div key={n.key} className={`banner${n.level === "info" ? "" : " banner--error"}`} role={n.level === "error" ? "alert" : "status"}>
          <Icon name={n.level === "info" ? "info" : "warning"} size={18} />
          <div className="banner__text">{n.message}</div>
          <IconButton icon="close" label="Dismiss" onClick={() => getApp().notices.getState().dismiss(n.key)} />
        </div>
      ))}
    </div>
  );
}

function SearchResults({ query, onPick }: { readonly query: string; readonly onPick: () => void }) {
  const hits = searchSettings(query);
  return (
    <section aria-label="Search results">
      <header className="page-header">
        <div className="page-header__eyebrow">
          <span className="status-dot" aria-hidden="true" />
          <span className="caps">Search</span>
        </div>
        <h1 className="page-header__title page-header__title--search">{hits.length === 0 ? "No match" : hits.length === 1 ? "1 match" : `${hits.length} matches`}</h1>
        <p className="page-header__desc">
          {hits.length === 0 ? `Nothing in Settings mentions "${query}". Try a shorter or different word.` : `For "${query}".`}
        </p>
      </header>
      <ul className="results">
        {hits.map((hit) => (
          <li key={hit.id}>
            <a className="result" href={`#/${hit.page}?focus=${hit.id}`} onClick={onPick}>
              <span className="result__icon" aria-hidden="true">
                <Icon name={pageById(hit.page).icon} size={18} />
              </span>
              <span className="result__text">
                <span className="result__title">{hit.title}</span>
                <span className="caps">{hit.pageTitle}</span>
              </span>
              <Icon name="chevron" size={16} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SettingsApp() {
  useAppearance();
  const route = useRoute();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLElement>(null);
  useFocusSetting(route, content);

  useEffect(() => {
    document.title = `${pageById(route.page).title} · ${PRODUCT_NAME} Settings`;
    content.current?.scrollTo({ top: 0 });
  }, [route.page]);

  // "/" jumps to search from anywhere that isn't a text field, as in most documentation sites.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !target.closest("input, textarea, select, [contenteditable='true']")) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clearSearch = (): void => setQuery("");
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") {
      clearSearch();
    } else if (e.key === "Enter") {
      const first = searchSettings(query)[0];
      if (first) {
        window.location.hash = `#/${first.page}?focus=${first.id}`;
        clearSearch();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      content.current?.querySelector<HTMLElement>(".result")?.focus();
    }
  };
  const onNavKey = (e: KeyboardEvent<HTMLElement>): void => {
    const links = [...e.currentTarget.querySelectorAll<HTMLElement>("a")];
    const index = links.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? index + 1 : e.key === "ArrowUp" ? index - 1 : e.key === "Home" ? 0 : e.key === "End" ? links.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    links[(next + links.length) % links.length]?.focus();
  };

  return (
    <div className="settings">
      <a className="skip-link" href="#content" onClick={(e) => { e.preventDefault(); content.current?.focus(); }}>
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar__brand" data-tauri-drag-region>
          <span className="status-dot" aria-hidden="true" />
          <span className="sidebar__name">{PRODUCT_NAME}</span>
          <span className="caps">Settings</span>
        </div>
        <label className="search">
          <Icon name="search" size={16} />
          <input
            ref={search}
            type="search"
            name="search"
            value={query}
            placeholder="Search settings"
            aria-label="Search settings"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={onSearchKey}
          />
          {query === "" ? <Kbd>/</Kbd> : null}
        </label>
        <nav aria-label="Settings pages" onKeyDown={onNavKey}>
          <ul className="nav">
            {PAGES.map((p) => (
              <li key={p.id}>
                <a className="nav__item" href={`#/${p.id}`} aria-current={query === "" && route.page === p.id ? "page" : undefined} onClick={clearSearch}>
                  <Icon name={p.icon} size={18} />
                  {p.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main id="content" ref={content} className="content" tabIndex={-1}>
        <div className="content__inner">
          <Notices />
          {query.trim() !== "" ? <SearchResults query={query} onPick={clearSearch} /> : PAGE_COMPONENTS[route.page]()}
        </div>
      </main>
      <UndoBar />
    </div>
  );
}
