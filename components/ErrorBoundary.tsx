import React from 'react';
import { reportCaught } from '../services/errorReporter';

// --- ERROR BOUNDARIES ---
// A fault while drawing part of the screen replaces only that part with a short note. Without a
// boundary React unmounts everything on a render error, leaving an empty page: the conversation, the
// structure and the reason all gone. Boundaries sit around the whole app, the 3D workspace and each chat
// message, and each reports what it caught, like any other fault in the app's code.

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback: (retry: () => void) => React.ReactNode;
  resetKey?: unknown; // When this changes (another structure opened), the part is drawn afresh
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportCaught(error);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  retry = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

const WarningIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);

const primaryButton = 'h-8 touch:h-10 px-3.5 rounded-md bg-brand text-brand-ink text-xs touch:text-[13px] font-semibold hover:bg-brand-dark transition-colors';
const quietButton = 'h-8 touch:h-10 px-3 rounded-md border border-line text-xs touch:text-[13px] font-medium text-ink hover:border-line-2 hover:text-ink-strong transition-colors';

/** The last resort, when the app itself can't be drawn: reload, or start without the address's view. */
export const AppCrash: React.FC = () => (
  <div role="alert" data-crash="app" className="fixed inset-0 grid place-items-center bg-canvas px-6">
    <div className="max-w-sm text-center">
      <span className="inline-grid place-items-center w-10 h-10 rounded-full border border-line text-bad"><WarningIcon /></span>
      <h1 className="mt-4 text-[17px] font-semibold tracking-tight text-ink-strong">Something went wrong</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">Argus hit an unexpected problem and couldn't draw this screen. Reloading usually fixes it.</p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <button type="button" onClick={() => location.reload()} className={primaryButton}>Reload</button>
        {/* A share link reloads into the same view, so this opens the app without it */}
        <button type="button" onClick={() => location.assign('/app')} className={quietButton}>Start fresh</button>
      </div>
    </div>
  </div>
);

/** The 3D workspace couldn't be drawn: the chat beside it carries on. */
export const PaneCrash: React.FC<{ onRetry: () => void; headerStart?: React.ReactNode }> = ({ onRetry, headerStart }) => (
  <div data-crash="workspace" className="h-full flex flex-col bg-canvas">
    {/* On a phone, the switch back to the chat lives in this header */}
    {headerStart && <div className="h-11 flex items-center px-3 border-b border-line flex-shrink-0">{headerStart}</div>}
    <div role="alert" className="flex-1 grid place-items-center px-6">
      <div className="max-w-xs text-center">
        <span className="inline-grid place-items-center w-10 h-10 rounded-full border border-line text-bad"><WarningIcon /></span>
        <p className="mt-3 text-sm font-semibold text-ink-strong">The 3D view hit a problem</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">Your conversation is safe. Try again, or open another structure from the chat.</p>
        <button type="button" onClick={onRetry} className={`mt-4 ${primaryButton}`}>Try again</button>
      </div>
    </div>
  </div>
);

/** One chat message couldn't be drawn: the rest of the conversation stays. */
export const MessageCrash: React.FC = () => (
  <p role="alert" data-crash="message" className="flex items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-chat-aside text-ink-muted">
    <span className="text-bad flex-shrink-0"><WarningIcon /></span>
    This message couldn't be shown.
  </p>
);
