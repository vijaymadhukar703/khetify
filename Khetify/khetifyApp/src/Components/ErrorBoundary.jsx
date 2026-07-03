import React from 'react';

/**
 * Catches render errors in the tree below it and shows the message instead of a
 * blank white screen. Keeps one broken page from taking down the whole app and
 * makes runtime errors visible (and reportable) immediately.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('UI error boundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 p-8 font-sora">
          <div className="max-w-2xl mx-auto bg-red-50 border border-red-200 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-red-700">Something went wrong on this page</h2>
            <p className="text-sm text-stone-600 mt-1">The rest of the app is fine. Try reloading; if it persists, share this message:</p>
            <pre className="mt-3 text-xs bg-white border border-red-100 rounded-lg p-3 overflow-auto text-red-700 whitespace-pre-wrap">{String(this.state.error?.stack || this.state.error)}</pre>
            <button onClick={() => this.setState({ error: null })} className="mt-4 bg-[#EA2831] text-white rounded-lg px-4 py-2 text-sm font-bold">Try again</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
