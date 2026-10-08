import { useEffect, useState } from 'react';

// Phones get their own arrangement: one pane at a time, panels that rise from the bottom. A phone is
// a narrow window, or a short touch screen (a phone on its side is wide but only ~400px tall).
export const PHONE_QUERY = '(max-width: 767px), (max-height: 520px) and (pointer: coarse)';
// A finger rather than a mouse: no hover, bigger targets, no keyboard hints
export const TOUCH_QUERY = '(pointer: coarse)';

const matches = (query: string) => typeof window !== 'undefined' && window.matchMedia(query).matches;

/** Whether a media query matches, kept up to date as the window changes. */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setValue(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return value;
}

export const isTouch = () => matches(TOUCH_QUERY);
