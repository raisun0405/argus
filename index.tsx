import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App';
import ErrorBoundary, { AppCrash } from './components/ErrorBoundary';
import './index.css';
import { buildThemeCss } from './themes';
import { initTheme } from './useTheme';
import { startErrorReports } from './services/errorReporter';
import { SAVED_PREFIX, openSavedFromAddress } from './services/savedService';

// A fault in this page's code is reported, so one on the live site doesn't go unseen
startErrorReports();

// Theme variables are normally inlined into app.html at build time; inject
// them here only if that step was skipped, then restore the saved theme.
if (!document.getElementById('argus-theme-vars')) {
  const themeStyle = document.createElement('style');
  themeStyle.id = 'argus-theme-vars';
  themeStyle.textContent = buildThemeCss();
  document.head.appendChild(themeStyle);
}
initTheme();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const start = () => ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    {/* A fault the panes' own boundaries don't catch shows a way back instead of an empty page */}
    <ErrorBoundary fallback={() => <AppCrash />}>
      <App />
    </ErrorBoundary>
    <Analytics />
  </React.StrictMode>
);

// A saved result's short link (#s=...) is fetched first, so the app opens straight onto it
if (window.location.hash.startsWith(SAVED_PREFIX)) {
  rootElement.innerHTML = '<p style="font: 13px/1.5 Inter, system-ui, sans-serif; color: rgb(var(--c-ink-muted, 136 136 136)); text-align: center; padding-top: 40vh">Opening the saved result…</p>';
  openSavedFromAddress().finally(start);
} else {
  start();
}
