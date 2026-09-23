import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center text-bad">
          <h1 className="text-2xl font-bold mb-4">Something went wrong.</h1>
          <pre className="bg-bg/30 p-4 rounded text-left overflow-auto text-xs font-mono">
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-4 px-4 py-2 bg-surface-2 text-text rounded hover:bg-surface-2"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
