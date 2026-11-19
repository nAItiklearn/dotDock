import { Component, useMemo, type ErrorInfo, type ReactNode } from "react";
import { Surface } from "../design-system/primitives";
import { getWidget, resolveConfig, resolveSize, type AnyWidgetDefinition } from "./registry";
import { WidgetNotice } from "./WidgetNotice";

interface BoundaryProps {
  readonly def: AnyWidgetDefinition;
  readonly w: number;
  readonly h: number;
  /** A new key clears a caught error, e.g. after the user changes the widget's settings. */
  readonly resetKey: string;
  readonly children: ReactNode;
}

interface BoundaryState {
  readonly failed: boolean;
  readonly key: string;
}

/** One broken widget must never take the desktop down with it. */
class WidgetBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Pick<BoundaryState, "failed"> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): BoundaryState | null {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`widget "${this.props.def.id}" failed`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { def, w, h, children } = this.props;
    if (!this.state.failed) return children;
    return (
      <Surface shape="card" w={w} h={h} label={def.name}>
        <WidgetNotice title={def.name} issue="error" message="This widget stopped" />
      </Surface>
    );
  }
}

export interface WidgetViewProps {
  readonly id: string;
  readonly size?: string;
  /** Stored config; anything invalid is replaced by the widget's defaults. */
  readonly config?: unknown;
}

/** Renders any registered widget at a size with a validated config, isolated from failures. */
export function WidgetView({ id, size, config }: WidgetViewProps) {
  const def = getWidget(id);
  const spec = def ? resolveSize(def, size) : null;
  const resolved = useMemo(() => (def ? resolveConfig(def, config) : null), [def, config]);
  if (!def || !spec || !resolved) {
    return (
      <Surface shape="card" w={2} h={2} label="Unknown widget">
        <WidgetNotice title={id} issue="unsupported" message="No such widget" />
      </Surface>
    );
  }
  const Body = def.component;
  return (
    <WidgetBoundary def={def} w={spec.w} h={spec.h} resetKey={`${def.id}:${spec.id}:${JSON.stringify(resolved)}`}>
      <Body size={spec.id} config={resolved} />
    </WidgetBoundary>
  );
}
