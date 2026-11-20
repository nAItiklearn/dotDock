import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { IconButton } from "../../lib/ui/controls";
import { hrefFor, pageById, pagesOf, sectionById, type PageId } from "../sections";

// ------------------------------------------------------------ link navigation

/**
 * Arrow keys move between the links of a list (the sidebar, a tab strip), Home and End jump to the
 * ends, and the focus wraps. Tab still leaves the list, as everywhere else.
 */
export function moveFocusAmongLinks(e: KeyboardEvent<HTMLElement>, axis: "vertical" | "horizontal"): void {
  const forward = axis === "vertical" ? "ArrowDown" : "ArrowRight";
  const back = axis === "vertical" ? "ArrowUp" : "ArrowLeft";
  const links = [...e.currentTarget.querySelectorAll<HTMLElement>("a")];
  const index = links.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  const next = e.key === forward ? index + 1 : e.key === back ? index - 1 : e.key === "Home" ? 0 : e.key === "End" ? links.length - 1 : null;
  if (next === null) return;
  e.preventDefault();
  links[(next + links.length) % links.length]?.focus();
}

// ---------------------------------------------------------------- page header

/**
 * Top of every page: the section it belongs to, the page title and what the page is for, then the
 * section's pages as tabs, so everything about one part of the product is a click away.
 */
export function PageHeader({ page }: { readonly page: PageId }) {
  const meta = pageById(page);
  const section = sectionById(meta.section);
  const siblings = pagesOf(meta.section);
  const heading = useRef<HTMLHeadingElement>(null);
  // Moving focus to the title on navigation tells screen-reader users where they are and
  // lets keyboard users continue from the top of the new page.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [page]);
  return (
    <header className="page-header">
      <div className="page-header__eyebrow">
        <span className="status-dot" aria-hidden="true" />
        <span className="caps">{section.title}</span>
      </div>
      <h1 ref={heading} tabIndex={-1} className="page-header__title">
        {meta.title}
      </h1>
      <p className="page-header__desc">{meta.description}</p>
      {siblings.length > 1 ? (
        <nav className="tabs" aria-label={`${section.title} pages`} onKeyDown={(e) => moveFocusAmongLinks(e, "horizontal")}>
          {siblings.map((p) => (
            <a key={p.id} className="tabs__item" href={hrefFor(p.id)} aria-current={p.id === page ? "page" : undefined}>
              {p.title}
            </a>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

// -------------------------------------------------------------------- section

export interface SectionProps {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  /** Optional controls on the title line, e.g. a "New" button. */
  readonly actions?: ReactNode;
}

export function Section({ title, description, children, actions }: SectionProps) {
  const id = useId();
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section__head">
        <div>
          <h2 id={id} className="section__title caps">
            {title}
          </h2>
          {description ? <p className="section__desc">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="card">{children}</div>
    </section>
  );
}

// ------------------------------------------------------------------------ row

export interface RowProps {
  /** Stable id: the search index points here, and the page scrolls to and flashes it. */
  readonly id: string;
  readonly label: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  /** When false and `onReset` is given, a reset button appears beside the control. */
  readonly isDefault?: boolean;
  readonly onReset?: () => void;
}

/** One setting: what it is, what it does, its control, and how to put it back. */
export function Row({ id, label, description, children, isDefault = true, onReset }: RowProps) {
  return (
    <div className="row" data-setting-id={id}>
      <div className="row__text">
        <div className="row__label">{label}</div>
        {description ? <p className="row__desc">{description}</p> : null}
      </div>
      <div className="row__control">
        {onReset ? (
          <span className="row__reset">
            {isDefault ? null : <IconButton icon="reset" label={`Reset ${label}`} onClick={onReset} />}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}
