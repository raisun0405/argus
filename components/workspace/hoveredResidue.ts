import { useSyncExternalStore } from 'react';

// --- THE RESIDUE UNDER THE POINTER ---
// Set by the 3D view, the sequence strip and the Focus list as the pointer moves; read only by the
// status bar. It lives outside React state so a sweep along the strip re-renders the status bar alone:
// as viewer state, every residue crossed re-rendered the whole workspace, which lagged visibly.

let current: string | null = null;
const listeners = new Set<() => void>();

/** The residue key under the pointer, or null when the pointer is on none. */
export const setHoveredResidue = (key: string | null) => {
  if (key === current) return;
  current = key;
  listeners.forEach(l => l());
};

export const useHoveredResidue = () => useSyncExternalStore(
  (l) => { listeners.add(l); return () => listeners.delete(l); },
  () => current,
  () => current,
);
