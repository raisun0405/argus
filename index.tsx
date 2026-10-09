import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App';
import './index.css';
import { buildThemeCss } from './themes';
import { initTheme } from './useTheme';
import { startErrorReports } from './services/errorReporter';

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

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>
);
