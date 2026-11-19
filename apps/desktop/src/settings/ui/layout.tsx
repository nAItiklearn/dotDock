import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "../../lib/ui/controls";

// ---------------------------------------------------------------- page header

export function PageHeader({ title, description }: { readonly title: string; readonly description: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Moving focus to the title on navigation tells screen-reader users where they are and
  // lets keyboard users continue from the top of the new page.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <header className="page-header">
      <div className="page-header__eyebrow">
        <span className="status-dot" aria-hidden="true" />
        <span className="caps">Settings</span>
      </div>
      <h1 ref={heading} tabIndex={-1} className="page-header__title">
        {title}
      </h1>
      <p className="page-header__desc">{description}</p>
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
