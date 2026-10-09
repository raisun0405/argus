// The landing page (index.html, served at /): its own behaviour and the toolkit and the answer check.
import { inject } from '@vercel/analytics';
import './page.js';
import './sections.js';

inject();

// Its WebGL (the 3D stage, the buttons' metal ring) is a file of its own, since three.js is most of the
// page's code: fetched alongside this one (vite.config.ts preloads it), but the page doesn't wait for it
import('./visuals.js').catch(err => { console.error('The 3D stage could not load', err); document.documentElement.dataset.stage = 'off'; });
