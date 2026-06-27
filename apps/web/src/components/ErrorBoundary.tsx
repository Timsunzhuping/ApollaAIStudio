import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { error: Error | null }

/** Catches render errors in any page so one broken view degrades to a message, not a white screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught', error, info.componentStack);
  }
  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="content">
          <div className="card col" role="alert">
            <h3>Something went wrong</h3>
            <div className="error">{this.state.error.message}</div>
            <div><button onClick={() => this.setState({ error: null })}>Try again</button></div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
