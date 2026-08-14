import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorFallbackProps = {
  retry: () => void;
};

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: (props: ErrorFallbackProps) => ReactNode;
  resetKeys?: readonly unknown[];
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("A render error reached an error boundary.", error, info);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error && resetKeysChanged(previous.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return this.props.fallback({ retry: this.retry });
    }
    return this.props.children;
  }
}

export function ApplicationErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={() => (
        <main className="application-error" role="alert">
          <div>
            <h1>The application could not load</h1>
            <p>Reload the application. If the problem continues, restart the local service.</p>
            <button className="button primary" type="button" onClick={() => window.location.reload()}>
              Reload application
            </button>
          </div>
        </main>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

function resetKeysChanged(
  previous: readonly unknown[] | undefined,
  current: readonly unknown[] | undefined,
): boolean {
  if (previous === current) return false;
  if (!previous || !current || previous.length !== current.length) return true;
  return previous.some((value, index) => !Object.is(value, current[index]));
}
