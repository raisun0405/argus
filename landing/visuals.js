// The landing page's WebGL, in a file of its own (main.js imports it) so the rest of the page works
// while three.js loads: the 3D stage behind the hero and the stories, and the ring of liquid metal on
// the buttons into the app.
import { startStage } from './stage.js';

// The 3D stage, if the browser can draw it; otherwise the hero shows a screenshot and the stories their cards
const root = document.documentElement;
const webgl = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
if (!webgl) root.dataset.stage = 'off';
else {
  const $ = s => document.querySelector(s);
  startStage({
    canvas: $('[data-stage-gl]'),
    layer: $('[data-stage-labels]'),
    sections: { ask: $('#ask'), tools: $('#tools'), overlay: $('#overlay'), after: $('#workspace') },
    slots: { hero: $('[data-slot="hero"]'), ask: $('[data-slot="ask"]'), tools: $('[data-slot="tools"]'), overlay: $('[data-slot="overlay"]') },
    grab: $('[data-slot="hero"]'),
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }).catch(err => { console.error('The 3D stage could not start', err); root.dataset.stage = 'off'; });

  // The buttons' ring of liquid metal (React and metal-fx), fetched once the page has loaded
  const hosts = document.querySelectorAll('[data-metal]');
  const ring = () => import('./metal.js')
    .then(({ mountMetal }) => hosts.forEach(host => { if (mountMetal(host, { strength: Number(host.dataset.metal) || 1 })) host.classList.add('is-metal'); }))
    .catch(err => console.warn('The metal ring could not load', err));
  if (hosts.length) (document.readyState === 'complete' ? ring() : addEventListener('load', ring, { once: true }));
}
