import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Short label that identifies this boundary in logs + the fallback DOM
   *  attribute (e.g. `app`, `workspace`, `image-node:${id}`). */
  label: string;
  children: ReactNode;
  /** Optional render-prop fallback. Receives the error and a retry callback
   *  that resets the boundary so children re-mount. When omitted, the
   *  default fallback panel is used. */
  fallback?: (error: Error, retry: () => void) => ReactNode;
  /** Hook for telemetry / sentry. Always called once when an error is caught. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Containment for thrown render errors. Without one of these on a parent
 * surface, a single render-time throw deep in the tree blanks the whole
 * editor — React 19 still unmounts the root on an uncaught error.
 *
 * We wrap three strategic surfaces: the App root (last-resort fallback),
 * the right sidebar (so an inspector panel crash doesn't take the canvas
 * with it), and each ImageNode (so one bad node doesn't kill all the
 * others). Crashes in throwaway preview overlays stay local.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Always log so devs see the stack in the console even when telemetry
    // isn't wired. Include the boundary label so the source is obvious.
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
    this.props.onError?.(error, info);
  }

  retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.retry);
    }

    return (
      <div
        data-testid="error-boundary-fallback"
        data-label={this.props.label}
        className="flex flex-col items-center justify-center gap-2 p-4 text-text-secondary text-[12px] bg-surface border border-separator rounded-[var(--radius-button)] m-2"
        role="alert"
      >
        <div className="font-medium text-text-primary">
          Something broke in “{this.props.label}”.
        </div>
        <pre className="max-w-full overflow-x-auto whitespace-pre-wrap text-[11px] opacity-70">
          {error.message}
        </pre>
        <button
          data-testid="error-boundary-retry"
          type="button"
          onClick={this.retry}
          className="px-2 py-1 text-[11px] rounded-[3px] bg-surface-secondary hover:bg-surface-secondary/80 border border-separator cursor-pointer"
        >
          Try again
        </button>
      </div>
    );
  }
}
