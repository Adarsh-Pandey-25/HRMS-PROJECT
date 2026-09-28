import { Component } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

/**
 * Catches render/runtime errors in its subtree and shows a fallback instead of
 * white-screening the whole app. Used at three levels:
 *   - app root (main.jsx) — ultimate catch-all
 *   - page content (AppLayout, keyed by route so it resets on navigation)
 *   - individual risky widgets (e.g. the WebGL 3D charts)
 *
 * `variant="inline"` renders a compact fallback that fits inside a card/chart;
 * the default renders a centered full-area fallback.
 */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    // Log only the error's own message/name and the component stack (a list of
    // component NAMES, no props or render data). Deliberately NOT error.stack
    // or any rendered value — those are what can carry PII.
    //
    // Swallowing this entirely used to make production crashes undiagnosable:
    // React does not log boundary-caught errors itself in a production build,
    // so a blank "Something went wrong" left literally no trace anywhere.
    // Wire a remote error service here if needed (Sentry, etc.).
    console.error(
      `[ErrorBoundary] ${error?.name || 'Error'}: ${error?.message || 'unknown error'}`,
      errorInfo?.componentStack || '(no component stack)',
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    if (this.props.variant === 'inline') {
      return (
        <div className="flex h-full min-h-[160px] w-full flex-col items-center justify-center gap-2 rounded-2xl bg-muted/40 p-6 text-center">
          <AlertTriangle className="h-6 w-6 text-warning" />
          <p className="text-sm font-medium text-fg">{this.props.label || "This section couldn't be displayed"}</p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RotateCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      );
    }

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10 text-danger">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-fg">Something went wrong</h1>
          <p className="mt-1 max-w-md text-sm text-fg-muted">
            An unexpected error occurred while displaying this page. Your data is safe — try again or reload the app.
          </p>
        </div>
        {/* Collapsed by default: end users never see it unless they open it,
            but it means a support screenshot carries the actual cause instead
            of just "Something went wrong". Message/name only — no render data. */}
        <details className="max-w-md text-left">
          <summary className="cursor-pointer text-xs text-fg-subtle hover:text-fg-muted">Technical details</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-left text-xs text-fg-muted">
            {`${error?.name || 'Error'}: ${error?.message || 'unknown error'}`}
          </pre>
        </details>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-fg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RotateCw className="h-4 w-4" /> Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
