import React from 'react';

// --- TOOL ICONS ---
// The icons the tools are known by, shared by the viewer's toolbar and the chat cards that show their
// results, so a result is headed by the same mark as the button that made it. Each is drawn on a
// 24px grid and takes the size it is shown at (13px in the toolbar, 12px on a card).

const svg = (size: number, strokeWidth: number, children: React.ReactNode) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

/** Partners: a hub joined to three nodes. */
export const NetworkIcon: React.FC<{ size?: number }> = ({ size = 13 }) =>
  svg(size, 2, <><circle cx="12" cy="12" r="2.5" /><circle cx="12" cy="3.5" r="1.8" /><circle cx="4.5" cy="18.5" r="1.8" /><circle cx="19.5" cy="18.5" r="1.8" /><path d="M12 9.5V5.3M9.9 13.4l-4 3.6M14.1 13.4l4 3.6" /></>);

/** Co-fold: a small molecule, a hexagon with a side group. */
export const MoleculeIcon: React.FC<{ size?: number }> = ({ size = 13 }) =>
  svg(size, 2, <><path d="M9 3.5 15 7v7l-6 3.5L3 14V7z" /><path d="m15 14 3.6 2.2" /><circle cx="20.4" cy="17.6" r="2.1" /></>);

/** AlphaFold: a four-point spark. */
export const SparkIcon: React.FC<{ size?: number }> = ({ size = 13 }) =>
  svg(size, 2, <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />);

/** Find similar: two overlapping shapes. The magnifier already means "search commands" in the top bar. */
export const SimilarIcon: React.FC<{ size?: number }> = ({ size = 13 }) =>
  svg(size, 2.25, <><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" /></>);

/** Compare: two panels side by side, as the inspector's Compare section draws it. */
export const CompareIcon: React.FC<{ size?: number }> = ({ size = 13 }) =>
  svg(size, 1.9, <><rect x="3" y="4" width="7.5" height="16" rx="2" /><rect x="13.5" y="4" width="7.5" height="16" rx="2" /></>);
