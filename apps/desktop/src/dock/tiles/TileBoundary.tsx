import { Component, type ErrorInfo, type ReactNode } from "react";
import { Icon } from "../../design-system/Icon";
import { t } from "../strings";
import { Mark, TileShell, Words } from "./shell";

/** How long a tile that failed waits before it tries to draw again, so a passing bad value heals by itself. */
export const TILE_RETRY_MS = 10_000;

/** What a tile shows after it failed to draw: its name and a quiet "could not read this", never a blank hole. */
export function TileFallback({ id }: { readonly id: string }) {
  const name = t(`tile.${id}` as Parameters<typeof t>[0]);
  return (
    <TileShell id={id} label={`${name}, ${t("tile.issue.error")}`} state="issue">
      <Mark tone="dim">
        <Icon name="reset" />
      </Mark>
      <Words title={t("tile.issue.error")} />
    </TileShell>
  );
}

interface Props {
  readonly id: string;
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
}

/**
 * Keeps one tile's failure inside that tile: the rest of the dock keeps working, the tile shows its fallback, logs
 * the error once, and tries again after a while.
 */
export class TileBoundary extends Component<Props, State> {
  override state: State = { failed: false };
  private retry: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`dock tile "${this.props.id}" failed to draw`, error, info.componentStack);
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.setState({ failed: false });
    }, TILE_RETRY_MS);
  }

  override componentWillUnmount(): void {
    if (this.retry !== null) clearTimeout(this.retry);
  }

  override render(): ReactNode {
    return this.state.failed ? <TileFallback id={this.props.id} /> : this.props.children;
  }
}
