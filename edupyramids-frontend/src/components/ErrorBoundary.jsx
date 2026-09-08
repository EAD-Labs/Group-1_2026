import { Component } from 'react';

/**
 * Catches a render crash anywhere below it so the whole app does not go blank.
 *
 * Still a class: React has no hook equivalent of componentDidCatch.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render failed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="auth">
        <div className="card auth-card">
          <h1>Something went wrong</h1>
          <p className="muted">
            The page could not be displayed. Reloading usually fixes it.
          </p>
          <button className="btn" type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
          {import.meta.env.DEV && (
            <pre className="trace">{String(this.state.error)}</pre>
          )}
        </div>
      </main>
    );
  }
}
