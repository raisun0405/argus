import { useEffect, useState } from 'react';
import { DEFAULT_THEME, THEME_STORAGE_KEY, ThemeId, isThemeId } from './themes';

// Theme state lives on <html data-theme>, not in React, so the CSS variables
// swap without a re-render. Components that need the *value* (the 3D viewer
// has to hand real hex colours to WebGL) subscribe through the event below.
const THEME_EVENT = 'argus:themechange';

export function readTheme(): ThemeId {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const current = document.documentElement.dataset.theme;
  return isThemeId(current) ? current : DEFAULT_THEME;
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Private mode / blocked storage: the theme still applies for this session.
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: id }));
}

/**
 * Restores the theme. Call once, before first render.
 *
 * A `?theme=peach` query wins over the saved choice (and is then saved), so a
 * link can open the app in a specific palette.
 */
export function initTheme(): ThemeId {
  const fromUrl = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(fromUrl)) {
    applyTheme(fromUrl);
    return fromUrl;
  }

  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    saved = null;
  }
  const id = isThemeId(saved) ? saved : DEFAULT_THEME;
  document.documentElement.dataset.theme = id;
  return id;
}

export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const [theme, setTheme] = useState<ThemeId>(readTheme);

  useEffect(() => {
    const onChange = (e: Event) => setTheme((e as CustomEvent<ThemeId>).detail);
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  return [theme, applyTheme];
}
