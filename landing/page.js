// The landing page's own behaviour: the nav, the labels and numbers that animate in, Investigate's
// replay, which step of each scroll story shows, and the stories' cards (Pocket Radar and Interactions,
// from the app's own code). The 3D side is stage.js; the toolkit and the answer check, sections.js.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (/Mac|iPhone|iPad/.test(navigator.platform)) document.querySelectorAll('[data-mod]').forEach(k => { k.textContent = '⌘'; });

// Nav: glass after the first scroll; hides while reading down, back on scrolling up or near the top
const nav = document.querySelector('[data-nav]');
let lastY = scrollY;
addEventListener('scroll', () => {
  const y = scrollY;
  nav.classList.toggle('scrolled', y > 8);
  if (y > 140 && y > lastY + 4) nav.classList.add('hidden');
  else if (y < lastY - 4 || y <= 140) nav.classList.remove('hidden');
  lastY = y;
}, { passive: true });
addEventListener('mousemove', e => { if (e.clientY < 72) nav.classList.remove('hidden'); }, { passive: true });

// Small labels resolve from random letters, left to right, once each
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const scramble = el => {
  if (reduced || el.dataset.done) return;
  el.dataset.done = '1';
  const target = el.textContent;
  const start = performance.now();
  const frame = now => {
    const t = Math.min(1, (now - start) / 700);
    const shown = Math.floor(t * target.length);
    el.textContent = target.split('').map((c, i) => (i < shown || c === ' ' ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('');
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = target;
  };
  requestAnimationFrame(frame);
};

// Numbers count up when they come into view
const countUp = el => {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target) || reduced) return;
  const decimals = Number(el.dataset.decimals || 0);
  const suffix = el.dataset.suffix || '';
  const start = performance.now();
  const frame = now => {
    const t = Math.min(1, (now - start) / 1400);
    const eased = 1 - Math.pow(1 - t, 4);
    el.innerHTML = (target * eased).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

// Investigate: the steps run one after another, then the answer appears
const runInvestigation = card => {
  const steps = [...card.querySelectorAll('.step')];
  const answer = card.querySelector('.answer');
  if (reduced) { steps.forEach(s => s.classList.add('done')); answer.classList.add('in'); return; }
  steps.forEach((step, i) => {
    setTimeout(() => step.classList.add('running'), 300 + i * 700);
    setTimeout(() => { step.classList.remove('running'); step.classList.add('done'); }, 900 + i * 700);
  });
  setTimeout(() => answer.classList.add('in'), 1000 + steps.length * 700);
};

const seen = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const el = entry.target;
    el.classList.add('in');
    el.querySelectorAll('[data-scramble]').forEach(scramble);
    if (el.matches('[data-scramble]')) scramble(el);
    el.querySelectorAll('[data-count]').forEach(countUp);
    if (el.matches('[data-investigation]')) runInvestigation(el);
    seen.unobserve(el);
  }
}, { threshold: .1, rootMargin: '0px 0px -6% 0px' });
document.querySelectorAll('.reveal').forEach(el => seen.observe(el));
document.querySelector('[data-year]').textContent = new Date().getFullYear();
document.querySelector('[data-app-address]').textContent = `${location.host}/app`;

// --- The stories' panels: the 3D side is the stage (stage.js), which reads the same scroll ---
const POCKET_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa']; // The app's pocket colours
const TYPE_COLORS = { hbond: '#60a5fa', salt_bridge: '#f59e0b', water_bridge: '#7dd3fc', hydrophobic: '#a3a3a3' }; // The app's interaction colours
const TYPE_NAMES = { hbond: 'Hydrogen bond', salt_bridge: 'Salt bridge', water_bridge: 'Water bridge', hydrophobic: 'Hydrophobic' };
const NAME = { ASP: 'Asp', GLY: 'Gly', ARG: 'Arg', ILE: 'Ile', ALA: 'Ala', VAL: 'Val', LEU: 'Leu', PRO: 'Pro', THR: 'Thr', LYS: 'Lys' };
const resName = p => `${NAME[p.resn] ?? p.resn}${p.resi}`;
const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Which step's text, card, chat lines and progress show
const showStep = (section, step) => {
  section.querySelectorAll('[data-step]').forEach(el => el.classList.toggle('on', Number(el.dataset.step) === step));
  section.querySelectorAll('[data-show]').forEach(el => el.classList.toggle('off', !el.dataset.show.split(' ').includes(String(step))));
  section.querySelectorAll('[data-on]').forEach(el => el.classList.toggle('on', Number(el.dataset.on) === step));
  section.querySelectorAll('.progress li').forEach((li, i) => { li.classList.toggle('on', i === step); li.classList.toggle('done', i < step); });
  section.querySelectorAll('.chat-body').forEach(body => {
    body.classList.toggle('overflow', body.scrollHeight > body.clientHeight + 1);
    body.scrollTo({ top: body.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  });
};
// Which step the reader is on: the section is tall, its panel is pinned; progress through it picks the step
const progressOf = section => {
  const r = section.getBoundingClientRect();
  const span = r.height - innerHeight;
  return span > 0 ? clamp01(-r.top / span) : 0;
};
const stories = [...document.querySelectorAll('[data-story]')].map(section => ({ section, steps: Number(getComputedStyle(section).getPropertyValue('--steps')) || 1, step: -1 }));
const morphCard = document.querySelector('[data-morph]');
const overlayStory = document.getElementById('overlay');
const hero = document.querySelector('[data-hero]');
const heroSlot = document.querySelector('[data-slot="hero"]');
const onScroll = () => {
  for (const s of stories) {
    const step = Math.min(s.steps - 1, Math.floor(progressOf(s.section) * s.steps));
    if (step !== s.step) { s.step = step; showStep(s.section, step); }
  }
  // Overlay's card follows the lid, on the stage's timing
  morphCard.style.setProperty('--morph', smooth(0.5, 0.9, progressOf(overlayStory)).toFixed(3));
  // The cue and the label go as soon as the page moves; the caption once the structure settles over it
  hero.style.setProperty('--hero-out', clamp01(scrollY / 160).toFixed(3));
  const s = heroSlot.getBoundingClientRect();
  hero.style.setProperty('--caption-out', clamp01((innerHeight * 0.38 - (s.top + s.height / 2)) / (s.height * 0.4)).toFixed(3));
};
let scrollFrame = 0;
addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; onScroll(); }); }, { passive: true });
addEventListener('resize', onScroll);
onScroll();

// The cards' data: Pocket Radar's pockets and the drug's interactions, from the app's own code
const fillCards = data => {
  const pockets = document.querySelector('[data-pockets]');
  pockets.innerHTML = data.pockets.map((p, i) => {
    const chains = [...new Set(p.residues.map(r => r.chain))];
    const pct = Math.round(p.probability * 100);
    return `<div class="pocket"><div class="pocket-row"><i style="background:${POCKET_COLORS[i]}"></i><b>Pocket ${p.rank}</b>${i === 0 ? '<span class="pill">MK1</span>' : ''}<em>${pct}%</em></div>`
      + `<div class="bar"><i style="--w:${pct}%;--c:${POCKET_COLORS[i]};--d:${i * 0.12}s"></i></div><span class="dim">${p.residues.length} residues · ${chains.length > 1 ? 'chains' : 'chain'} ${chains.join(', ')}</span></div>`;
  }).join('');
  const counts = data.interactions.reduce((m, i) => ({ ...m, [i.type]: (m[i.type] ?? 0) + 1 }), {});
  document.querySelector('[data-contact-summary]').textContent = `${counts.hbond ?? 0} hydrogen bonds · ${counts.salt_bridge ?? 0} salt bridge`;
  // The seven closest hydrogen bonds, then the salt bridge in its own colour
  const shown = [
    ...data.interactions.filter(i => i.type === 'hbond').sort((a, b) => a.distance - b.distance).slice(0, 7),
    ...data.interactions.filter(i => i.type === 'salt_bridge'),
  ];
  const max = Math.max(...shown.map(i => i.distance));
  document.querySelector('[data-contacts]').innerHTML = shown.map(i =>
    `<li style="--c:${TYPE_COLORS[i.type]}"><s title="${TYPE_NAMES[i.type]}"></s><b>${resName(i.partner)} ${i.partner.chain}</b><span class="dim">${i.partner.atom ?? ''} ↔ ${i.ligandAtom ?? ''}</span><span class="bar"><i style="--w:${Math.round((1 - (i.distance - 2.3) / (max - 2.3 + 0.6)) * 100)}%;--c:${TYPE_COLORS[i.type]}"></i></span><em>${i.distance.toFixed(2)} Å</em></li>`).join('')
    + `<li style="grid-template-columns:1fr"><span class="dim">and ${counts.water_bridge ?? 0} water bridges, ${counts.hydrophobic ?? 0} hydrophobic contacts</span></li>`;
};
fetch('/landing/data/story.json').then(r => r.json()).then(fillCards).catch(e => console.warn('Story data missing', e));
