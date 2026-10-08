// Wraps a link that is already on the page in metal-fx's liquid-metal ring (silver, on dark). React
// renders only the ring's wrapper and a copy of the link, so the
// page works the same before this loads, or without WebGL2.
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { MetalFx } from 'metal-fx';

export function mountMetal(host, { strength = 1 } = {}) {
  const link = host.querySelector('a');
  if (!link) return null;
  const props = { className: link.className, href: link.getAttribute('href'), dangerouslySetInnerHTML: { __html: link.innerHTML } };
  for (const name of ['target', 'rel', 'aria-label']) if (link.hasAttribute(name)) props[name] = link.getAttribute(name);
  const root = createRoot(host);
  root.render(h(MetalFx, { preset: 'silver', theme: 'dark', variant: 'button', innerShadow: true, strength }, h('a', props)));
  return root;
}
