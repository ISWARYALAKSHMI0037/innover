import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { PrefsProvider } from './prefs.jsx';
import { ToastProvider } from './ui.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <h1>Something broke on this page</h1>
        <p>{String(this.state.error.message || this.state.error)}</p>
        <button className="btn btn-primary" onClick={() => { window.location.href = '/'; }}>Back to home</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <PrefsProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </PrefsProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
