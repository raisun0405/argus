// The toolkit's live previews and Validated's answer check. Every preview
// is real: Argus's own services run on KRAS against the public sources the app calls
// (data/kras-tools.json). Whatever looks like the chat is drawn the way the app draws its chat:
// the same bubbles, receipts, quiz card, loader orb and composer.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrowQ = matchMedia('(max-width: 820px)');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TICK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const CROSS = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
  const DOTS = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';
  const ARROW = '<svg class="arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';

  // The chat's loader orb: a ring of dots, still beside an answer, breathing while it works
  const ORB = (() => {
    let s = '<svg viewBox="0 0 20 20" aria-hidden="true">';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      s += `<circle cx="${(10 + 7 * Math.cos(a)).toFixed(2)}" cy="${(10 + 7 * Math.sin(a)).toFixed(2)}" r="1.15" style="--k:${i}"/>`;
    }
    return `${s}</svg>`;
  })();
  document.querySelectorAll('.orb').forEach(el => { el.innerHTML = ORB; });

  // The composer as the app draws it: the text on top, the + menu, the model and a round send button
  const composer = (text = '', typing = false) => `
    <div class="composer">
      <div class="composer-box">
        <p class="composer-input${text ? ' has-text' : ''}">${text ? `${esc(text)}${typing ? '<i class="caret"></i>' : ''}` : 'Ask Argus about a protein, or paste a sequence…'}</p>
        <div class="composer-row">
          <span class="c-plus" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>
          <span class="c-model">Nemotron 3 Super · Nebius</span>
          <span class="c-send${text ? ' is-ready' : ''}" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></span>
        </div>
      </div>
    </div>`;

  // ---------------- Toolkit ----------------
  const TOOLS = [
    { id: 'variant', name: 'Variant Lens', line: 'Colours every position by how harmful a change there would be, and lists the known disease variants.', source: 'AlphaMissense · UniProt' },
    { id: 'partners', name: 'Partners', line: 'Who it works with and the evidence behind each link. Partners solved together open as a complex, interface marked.', source: 'STRING · RCSB' },
    { id: 'similar', name: 'Find similar', line: 'Searches the PDB and AlphaFold DB for the same 3D shape, close relatives grouped so distant ones stand out.', source: 'Foldseek' },
    { id: 'alphafold', name: 'AlphaFold + AlphaFill', line: 'Switch to the full-length prediction, coloured by confidence, with cofactors and metals added from related entries.', source: 'AlphaFold DB · AlphaFill' },
    { id: 'fold', name: 'Fold a sequence', line: 'Paste a sequence of up to 400 residues and get its predicted structure in seconds.', source: 'ESMFold' },
    { id: 'quiz', name: 'Quizzes', line: 'Questions on what’s on screen. Get it right and the answer lights up in 3D.', source: 'Built in' },
    { id: 'palette', name: 'Ask the chat to do it', line: '“Surface, coloured by chain”, “hide waters”, “select A:12”: plain requests run at once, and the chat lists what changed.', source: 'Built in' },
    { id: 'share', name: 'Share links', line: 'Reopen the exact view on any device: the answer, colouring and camera. It travels in the link and never reaches a server.', source: 'Built in' },
  ];

  // greys from graphite to white, for a 0..1 value
  const grey = t => {
    const v = Math.round((0.15 + 0.82 * Math.pow(Math.min(1, Math.max(0, t)), 1.3)) * 255);
    return `rgb(${v}, ${Math.min(255, v + 2)}, ${Math.min(255, v + 6)})`;
  };
  const amClass = m => (m >= 0.564 ? 'likely pathogenic' : m <= 0.34 ? 'likely benign' : 'ambiguous');
  const f1 = x => x.toFixed(1);

  // 01 · Variant Lens: the pathogenicity landscape along the chain
  function variant(el, d) {
    const { mean, disease } = d.variants;
    const seq = d.protein.sequence;
    const n = mean.length;
    const narrow = narrowQ.matches;
    const W = narrow ? 380 : 640, H = 282, X0 = 16, X1 = W - 44, BASE = 236, TOP = 64;
    const bw = (X1 - X0) / n;
    const yOf = m => BASE - m * (BASE - TOP);
    const xOf = pos => X0 + (pos - 0.5) * bw;
    const tail = mean.slice(166);
    const tailMean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const label = (pos, text) => {
      const x = f1(xOf(pos));
      // over a pair of positions (12.5: G12 and G13), from the taller of the two bars
      const top = yOf(Math.max(mean[Math.floor(pos) - 1], mean[Math.ceil(pos) - 1])) - 12;
      return `<g class="vl-label"><line x1="${x}" x2="${x}" y1="${f1(top - 4)}" y2="34"/><text x="${x}" y="28" text-anchor="middle">${text}</text></g>`;
    };
    const idle = `<span>Mean AlphaMissense score at each of the ${n} positions · hover to read one</span>`;
    const g = yOf(0.564);
    el.innerHTML = `<div class="viz">
      <p class="viz-readout" aria-live="polite">${idle}</p>
      <svg class="vl" viewBox="0 0 ${W} ${H}" role="img" aria-label="AlphaMissense pathogenicity along KRAS: ${d.variants.pathogenic} of ${n} positions likely pathogenic, with the known disease variants marked">
        <line class="vl-guide" x1="${X0}" x2="${X1 + 4}" y1="${f1(g)}" y2="${f1(g)}"/>
        <text class="vl-small" x="${X1 + 8}" y="${f1(g + 4)}">0.564</text>
        ${mean.map((m, i) => `<rect class="vl-bar" x="${(X0 + i * bw + 0.35).toFixed(2)}" width="${Math.max(0.6, bw - 0.7).toFixed(2)}" y="${f1(yOf(m))}" height="${f1(BASE - yOf(m))}" fill="${grey(m)}" style="animation-delay:${i * 4}ms"/>`).join('')}
        ${Object.keys(disease).map(k => { const p = Number(k); return `<circle class="vl-dot" cx="${f1(xOf(p))}" cy="${f1(yOf(mean[p - 1]) - 7)}" r="2.2" style="animation-delay:${600 + p * 3}ms"/>`; }).join('')}
        ${label(12.5, 'G12 · G13')}${label(61, 'Q61')}${label(146, 'A146')}
        <g class="vl-tail"><path d="M${f1(xOf(167))} ${BASE + 14} v6 H${f1(xOf(189))} v-6"/><text class="vl-small" x="${f1((xOf(167) + xOf(189)) / 2)}" y="${BASE + 36}" text-anchor="middle">tail · mean ${tailMean.toFixed(2)}</text></g>
        <text class="vl-small" x="${X0}" y="${BASE + 18}">1</text>
        <text class="vl-small" x="${f1(xOf(100))}" y="${BASE + 18}" text-anchor="middle">100</text>
        ${narrow ? '' : `<g><line class="vl-guide" x1="${X0}" x2="${X0 + 18}" y1="${BASE + 32}" y2="${BASE + 32}"/><text class="vl-small" x="${X0 + 26}" y="${BASE + 36}">likely pathogenic above 0.564</text><circle class="vl-dot" cx="${X0 + 228}" cy="${BASE + 32}" r="2.6"/><text class="vl-small" x="${X0 + 238}" y="${BASE + 36}">known disease variant</text></g>`}
        <line class="vl-cursor" x1="0" x2="0" y1="${TOP - 10}" y2="${BASE}" visibility="hidden"/>
      </svg>
      ${narrow ? '<p class="viz-legend"><span><i></i>Likely pathogenic above 0.564</span><span><i class="is-dot"></i>Known disease variant</span></p>' : ''}
    </div>`;
    const svg = el.querySelector('svg');
    const readout = el.querySelector('.viz-readout');
    const cursor = el.querySelector('.vl-cursor');
    const bars = [...el.querySelectorAll('.vl-bar')];
    let at = null;
    svg.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect();
      const pos = Math.floor((((e.clientX - r.left) / r.width) * W - X0) / bw) + 1;
      const next = pos >= 1 && pos <= n ? pos : null;
      if (next === at) return;
      if (at) bars[at - 1].classList.remove('is-at');
      at = next;
      if (!at) { readout.innerHTML = idle; cursor.setAttribute('visibility', 'hidden'); return; }
      bars[at - 1].classList.add('is-at');
      cursor.setAttribute('x1', f1(xOf(at))); cursor.setAttribute('x2', f1(xOf(at))); cursor.setAttribute('visibility', 'visible');
      readout.innerHTML = `<b>${seq[at - 1]}${at}</b><span>mean ${mean[at - 1].toFixed(2)} · ${amClass(mean[at - 1])}</span>${disease[at] ? `<em>${disease[at].join(' · ')}</em>` : ''}`;
    });
    svg.addEventListener('pointerleave', () => {
      if (at) bars[at - 1].classList.remove('is-at');
      at = null;
      readout.innerHTML = idle;
      cursor.setAttribute('visibility', 'hidden');
    });
  }

  // 02 · Partners: who KRAS works with, and which have been solved together
  function partners(el, d) {
    const narrow = narrowQ.matches;
    const W = narrow ? 380 : 640, H = narrow ? 312 : 300, cx = W / 2, cy = H / 2;
    const rx = narrow ? 100 : 236, ry = narrow ? 124 : 108;
    const ps = d.partners;
    const nodes = ps.map((p, i) => {
      const a = -Math.PI / 2 + ((i + 0.5) / ps.length) * Math.PI * 2;
      return { ...p, a, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
    });
    el.innerHTML = `<div class="viz">
      <svg class="pt" viewBox="0 0 ${W} ${H}" role="img" aria-label="KRAS and its ten strongest STRING partners; solid lines mark the ones solved together with KRAS in the PDB">
        ${nodes.map((p, i) => `<line class="pt-edge${p.complexes ? ' is-solved' : ''}" x1="${cx}" y1="${cy}" x2="${f1(p.x)}" y2="${f1(p.y)}" style="animation-delay:${i * 70}ms"/>`).join('')}
        <circle class="pt-hub" cx="${cx}" cy="${cy}" r="27"/>
        <text class="pt-hub-text" x="${cx}" y="${cy + 4}" text-anchor="middle">KRAS</text>
        ${nodes.map((p, i) => {
          const c = Math.cos(p.a);
          const anchor = c > 0.25 ? 'start' : c < -0.25 ? 'end' : 'middle';
          const dx = anchor === 'start' ? 10 : anchor === 'end' ? -10 : 0;
          const dy = anchor === 'middle' ? (Math.sin(p.a) < 0 ? -12 : 20) : -2;
          const sub = p.complexes ? `${p.complexes} complex${p.complexes > 1 ? 'es' : ''}` : `STRING ${p.score.toFixed(3)}`;
          return `<g class="pt-node" style="animation-delay:${200 + i * 70}ms"><circle class="${p.complexes ? 'is-solved' : ''}" cx="${f1(p.x)}" cy="${f1(p.y)}" r="4.5"/><text class="pt-name" x="${f1(p.x + dx)}" y="${f1(p.y + dy)}" text-anchor="${anchor}">${esc(p.name)}</text><text class="pt-sub" x="${f1(p.x + dx)}" y="${f1(p.y + dy + 13)}" text-anchor="${anchor}">${sub}</text></g>`;
        }).join('')}
      </svg>
      <p class="viz-legend"><span><i class="is-solved"></i>Solved together in the PDB</span><span><i></i>Evidence only</span></p>
    </div>`;
  }

  // 03 · Find similar: thousands of hits, grouped so distant relatives stand out
  function similar(el, d) {
    const s = d.similar;
    const rows = ['P08644', 'Q5F352', 'P01112', 'B4NJ72', 'P61224', 'Q92963'].map(id => s.top.find(t => t.id === id)).filter(Boolean);
    el.innerHTML = `<div class="viz sim">
      <div class="sim-flow"><span><b>${s.totalHits.toLocaleString('en-US')}</b>hits</span><i>→</i><span><b>${s.groups}</b>proteins</span><i>+</i><span><b>${s.sameProteinStructures}</b>PDB entries of KRAS itself</span></div>
      <ul class="sim-rows">
        ${rows.map((g, i) => `<li style="--w:${g.identity}%;--d:${i * 70}ms"><span class="sim-name"><b>${esc(g.name)}</b><em>${esc(g.organism)}</em></span><span class="sim-bar"><i></i></span><span class="sim-id">${g.identity.toFixed(1)}%</span><span class="sim-n">${g.same ? 'same protein' : `${g.members} in group`}</span></li>`).join('')}
      </ul>
      <p class="viz-legend"><span>Sequence identity to KRAS · 6 of the ${s.groups} groups</span></p>
    </div>`;
  }

  // 04 · AlphaFold + AlphaFill: confidence along the chain, and the ligands transplanted onto it
  function alphafold(el, d) {
    const pl = d.alphafold.plddt;
    const n = pl.length;
    const narrow = narrowQ.matches;
    const W = narrow ? 380 : 640, H = 214, X0 = 16, X1 = W - 80, YT = 6, YB = 176;
    const x = i => X0 + (i / (n - 1)) * (X1 - X0);
    const y = v => YB - ((Math.max(40, v) - 40) / 60) * (YB - YT);
    const line = pl.map((v, i) => `${i ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))}`).join(' ');
    const bands = [{ from: 90, to: 100, label: 'Very high' }, { from: 70, to: 90, label: 'Confident' }, { from: 50, to: 70, label: 'Low' }, { from: 40, to: 50, label: 'Very low' }];
    const groups = new Map();
    for (const t of d.alphafold.transplants) {
      const g = groups.get(t.compound);
      if (g) g.count++;
      else groups.set(t.compound, { name: t.name, count: 1, source: t.source, confidence: t.confidence });
    }
    const chips = [...groups.entries()].slice(0, 3);
    const NAMES = { GNP: 'GTP analogue', MG: 'Mg²⁺', CA: 'Ca²⁺' };
    const more = d.alphafold.transplants.length - chips.reduce((a, [, g]) => a + g.count, 0);
    el.innerHTML = `<div class="viz af">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="AlphaFold model confidence along KRAS, mean pLDDT ${d.alphafold.mean}; low only in the C-terminal tail">
        <defs><linearGradient id="afFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FAFAFA" stop-opacity="0.26"/><stop offset="1" stop-color="#FAFAFA" stop-opacity="0"/></linearGradient></defs>
        ${bands.map((b, i) => `<g class="af-band"><rect x="${X0}" width="${X1 - X0}" y="${f1(y(b.to))}" height="${f1(y(b.from) - y(b.to))}" style="opacity:${[0.07, 0.045, 0.03, 0.015][i]}"/><text x="${X1 + 10}" y="${f1((y(b.to) + y(b.from)) / 2 + 4)}">${b.label}</text></g>`).join('')}
        <path class="af-area" d="${line} L${X1} ${YB} L${X0} ${YB} Z" fill="url(#afFill)"/>
        <path class="af-line" d="${line}" pathLength="1"/>
        <text class="vl-small" x="${X0}" y="${YB + 18}">1</text>
        <g class="af-note"><path d="M${f1(x(166))} ${YB + 8} v5 H${f1(x(188))} v-5"/><text x="${f1((x(166) + x(188)) / 2)}" y="${YB + 30}" text-anchor="middle">flexible tail</text></g>
      </svg>
      <div class="af-fill">
        <span class="dim">AlphaFill · ligands from related entries</span>
        <ul>
          ${chips.map(([code, g]) => `<li><b>${NAMES[code] ?? esc(g.name)}</b><span>${code}${g.count > 1 ? ` ×${g.count}` : ''} · from ${g.source} · ${g.confidence}</span></li>`).join('')}
          ${more > 0 ? `<li class="af-more">+${more} more</li>` : ''}
        </ul>
      </div>
    </div>`;
  }

  // 05 · Fold a sequence: the sequence lights up as ESMFold's backbone draws itself
  function fold(el, d) {
    const seq = d.protein.sequence;
    const lines = [];
    for (let i = 0; i < seq.length; i += 30) lines.push(seq.slice(i, i + 30));
    el.innerHTML = `<div class="viz fold">
      <div class="fold-seq" aria-label="The KRAS sequence, ${seq.length} residues">
        ${lines.map((l, li) => `<div class="fold-line"><span class="fold-n">${li * 30 + 1}</span><span class="fold-aa">${l.split('').map((ch, ci) => `<span${(ci + 1) % 10 === 0 ? ' class="gap"' : ''}>${ch}</span>`).join('')}</span></div>`).join('')}
      </div>
      <div class="fold-out"><canvas role="img" aria-label="ESMFold's predicted backbone for KRAS, drawn as it folds"></canvas><span class="fold-tag">ESMFold · ${d.esmfold.seconds} s</span></div>
    </div>`;
    const c = el.querySelector('canvas');
    const ctx = c.getContext('2d');
    const letters = [...el.querySelectorAll('.fold-aa span')];
    // the backbone, smoothed (Catmull-Rom, 4 steps a residue)
    const P = d.esmfold.ca, Q = d.esmfold.plddt;
    const pts = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      for (let s = 0; s < 4; s++) {
        const t = s / 4, t2 = t * t, t3 = t2 * t;
        const k = (a, b, cc, dd) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - dd) * t2 + (-a + 3 * b - 3 * cc + dd) * t3);
        pts.push({ p: [k(p0[0], p1[0], p2[0], p3[0]), k(p0[1], p1[1], p2[1], p3[1]), k(p0[2], p1[2], p2[2], p3[2])], q: Q[i] + (Q[i + 1] - Q[i]) * t, i });
      }
    }
    pts.push({ p: P[P.length - 1], q: Q[Q.length - 1], i: P.length - 1 });
    const BUILD = reduced ? 0 : 2400;
    let shown = 0, raf = 0;
    const t0 = performance.now();
    const draw = now => {
      const t = Math.max(0, now - t0);
      const k = BUILD ? Math.min(1, t / BUILD) : 1;
      const upto = Math.floor((1 - Math.pow(1 - k, 2)) * (pts.length - 1));
      const residues = upto >= pts.length - 1 ? P.length : pts[upto].i;
      for (; shown < residues; shown++) letters[shown]?.classList.add('on');
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio);
      if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const ang = 0.5 + (reduced ? 0 : t * 0.00018);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const scale = Math.min(r.width / 76, r.height / 44);
      const proj = pts.slice(0, upto + 1).map(({ p, q }) => {
        const X = p[0] * ca + p[2] * sa, Z = -p[0] * sa + p[2] * ca, f = 90 / (90 + Z);
        return { x: r.width / 2 + X * scale * f, y: r.height / 2 - p[1] * scale * f, z: Z, q };
      });
      const segs = [];
      for (let i = 0; i < proj.length - 1; i++) segs.push(i);
      segs.sort((a, b) => proj[b].z + proj[b + 1].z - (proj[a].z + proj[a + 1].z));
      ctx.lineCap = 'round';
      for (const i of segs) {
        const a = proj[i], b = proj[i + 1];
        const near = Math.min(1, Math.max(0, 0.5 - (a.z + b.z) / 2 / 40));
        const v = Math.round(110 + 135 * Math.min(1, Math.max(0, (a.q - 50) / 45)));
        ctx.strokeStyle = `rgba(${v}, ${v}, ${Math.min(255, v + 4)}, ${0.25 + 0.75 * near})`;
        ctx.lineWidth = 1 + 2.2 * near;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      // the growing end
      if (k < 1 && proj.length) {
        const e = proj[proj.length - 1];
        ctx.fillStyle = '#FAFAFA';
        ctx.beginPath(); ctx.arc(e.x, e.y, 3.2, 0, Math.PI * 2); ctx.fill();
      }
      if (!reduced || k < 1) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }

  // 06 · Quizzes: one to try, on the app's quiz card
  const QUIZ = {
    question: 'Sotorasib bonds covalently to KRAS G12C. Which residue does it bond to?',
    options: ['Gly13', 'Cys12', 'Gln61', 'Lys117'],
    right: 1,
    explanation: 'The G12C mutation put a cysteine at position 12, and sotorasib bonds to it in the switch-II pocket.',
  };
  function quiz(el, d, onUse) {
    let pick = null;
    const paint = () => {
      const answered = pick !== null;
      const right = pick === QUIZ.right;
      el.innerHTML = `<div class="viz quiz">
        <div class="quiz-card">
          <div class="quiz-top">
            <p class="quiz-k"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>Quick check</p>
            <h4>${QUIZ.question}</h4>
          </div>
          <div class="quiz-opts" role="group" aria-label="Answers">
            ${QUIZ.options.map((o, i) => {
              const state = !answered ? 'open' : i === QUIZ.right ? 'right' : i === pick ? 'wrong' : 'other';
              const mark = state === 'right' ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>'
                : state === 'wrong' ? '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' : '';
              return `<button type="button" class="quiz-opt" data-state="${state}" data-i="${i}"${answered ? ' disabled' : ''} aria-pressed="${pick === i}"><span class="quiz-radio" aria-hidden="true">${mark}</span><span>${o}</span></button>`;
            }).join('')}
          </div>
          ${answered ? `<div class="quiz-result${right ? ' is-right' : ''}" role="status"><div class="quiz-verdict-row"><p class="quiz-verdict">${right ? 'Correct' : 'Not quite'}</p><button type="button" class="quiz-again">Try again</button></div><p>${QUIZ.explanation}</p>${right ? '<p class="quiz-3d">Showing it in 3D</p>' : ''}</div>` : ''}
        </div>
      </div>`;
      el.querySelectorAll('.quiz-opt').forEach(b => b.addEventListener('click', () => { pick = Number(b.dataset.i); onUse(); paint(); }));
      el.querySelector('.quiz-again')?.addEventListener('click', () => { pick = null; paint(); });
    };
    paint();
  }

  // 07 · Ask the chat to do it: typed into the composer, sent, and answered with the app's own receipts
  const SCRIPT = [
    { ask: 'surface, coloured by chain', did: ['Shape: surface', 'Colour: chain'] },
    { ask: 'hide waters', did: ['Waters hidden'] },
    { ask: 'select A:12', did: ['Selected A:Cys12'] },
  ];
  function chat(el) {
    el.innerHTML = `<div class="viz chatx"><p class="chatx-ctx">6OIM on screen · KRAS G12C with sotorasib</p><div class="chatx-log"></div><div class="chatx-box"></div></div>`;
    const log = el.querySelector('.chatx-log');
    const box = el.querySelector('.chatx-box');
    const exchange = (x, withReceipt = true) => `<div class="msg-user"><p>${esc(x.ask)}</p></div>${withReceipt ? `<div class="msg"><span class="orb">${ORB}</span><ul class="receipt">${x.did.map(t => `<li>${TICK}<span>${esc(t)}</span></li>`).join('')}</ul></div>` : ''}`;
    if (reduced) { log.innerHTML = SCRIPT.map(x => exchange(x)).join(''); box.innerHTML = composer(); return; }
    let timer = 0, s = 0, c = 0;
    box.innerHTML = composer();
    const tick = () => {
      if (s >= SCRIPT.length) { // hold, then start over
        timer = setTimeout(() => { s = 0; c = 0; log.innerHTML = ''; box.innerHTML = composer(); timer = setTimeout(tick, 600); }, 3600);
        return;
      }
      const x = SCRIPT[s];
      if (c < x.ask.length) { c++; box.innerHTML = composer(x.ask.slice(0, c), true); timer = setTimeout(tick, 38 + Math.random() * 40); return; }
      // sent: the message goes up, the composer clears, then the receipt arrives
      box.innerHTML = composer();
      log.insertAdjacentHTML('beforeend', exchange(x, false));
      timer = setTimeout(() => {
        log.insertAdjacentHTML('beforeend', `<div class="msg"><span class="orb">${ORB}</span><ul class="receipt">${x.did.map(t => `<li>${TICK}<span>${esc(t)}</span></li>`).join('')}</ul></div>`);
        s++; c = 0;
        timer = setTimeout(tick, 1500);
      }, 380);
    };
    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }

  // 08 · Share links: a real one, taken apart
  function share(el, d) {
    const url = d.share.url;
    const cut = url.indexOf('#');
    const rows = [['structure', '6OIM'], ['answer', 'KRAS G12C with sotorasib (AMG 510)'], ['marked', 'Cys12 · sotorasib (MOV)'], ['colour', 'chain'], ['shape', 'cartoon']];
    el.innerHTML = `<div class="viz share">
      <div class="share-url"><span class="share-base">${esc(location.host + url.slice(0, cut))}</span><span class="share-frag">${esc(url.slice(cut))}</span></div>
      <p class="viz-legend share-key"><span><i class="is-base"></i>Sent to the server</span><span><i class="is-frag"></i>Stays in your browser: browsers never send what follows #</span></p>
      <dl class="share-decoded">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <a class="share-open" href="${esc(url)}" target="_blank" rel="noopener">Open this view in Argus ${ARROW}</a>
    </div>`;
  }

  const PREVIEWS = { variant, partners, similar, alphafold, fold, quiz, palette: chat, share };
  const finding = (id, d) => {
    switch (id) {
      case 'variant': return `${d.variants.pathogenic} of ${d.protein.length} positions likely pathogenic · ${Object.keys(d.variants.disease).length} with known disease variants`;
      case 'partners': {
        const solved = d.partners.filter(p => p.complexes > 0);
        const raf1 = d.partners.find(p => p.name === 'RAF1');
        return `${solved.length} of ${d.partners.length} top partners solved together with KRAS${raf1?.best ? ` · RAF1’s best is ${raf1.best} at ${raf1.bestResolution} Å` : ''}`;
      }
      case 'similar': return `${d.similar.totalHits.toLocaleString('en-US')} hits grouped into ${d.similar.groups} proteins, from KRAS in rat down to Rit1 at 45% identity`;
      case 'alphafold': return `Mean pLDDT ${d.alphafold.mean} · low only in the flexible tail · ${d.alphafold.transplants.length} ligands placed by AlphaFill`;
      case 'fold': return `${d.protein.length} residues folded in ${d.esmfold.seconds} s · mean pLDDT ${d.esmfold.meanPlddt}`;
      case 'quiz': return 'Quizzes come with answers; the options are shuffled so the right one isn’t always first';
      case 'palette': return 'Plain requests run at once, without the AI; the app writes each receipt, never the AI';
      case 'share': return 'A real link, made by Argus’s own code: open it and Argus shows 6OIM as described';
      default: return '';
    }
  };

  const toolkit = document.querySelector('[data-toolkit]');
  if (toolkit) {
    const index = toolkit.querySelector('[data-tk-index]');
    const tabs = [...index.querySelectorAll('.tk-tab')];
    const panel = toolkit.querySelector('[data-tk-panel]');
    const body = toolkit.querySelector('[data-tk-body]');
    const foot = toolkit.querySelector('[data-tk-foot]');
    const title = toolkit.querySelector('[data-tk-title]');
    const context = toolkit.querySelector('[data-tk-context]');
    let data = null, active = 0, auto = !reduced, paused = false, inView = false, cleanup = null;
    const sync = () => {
      toolkit.classList.toggle('is-auto', auto);
      toolkit.classList.toggle('is-paused', !(auto && !paused && inView));
    };
    const replay = node => { node.classList.remove('is-in'); void node.offsetWidth; node.classList.add('is-in'); };
    const render = () => {
      cleanup?.();
      cleanup = null;
      const t = TOOLS[active];
      tabs.forEach((b, i) => { const on = i === active; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      panel.setAttribute('aria-labelledby', tabs[active].id);
      title.textContent = t.name;
      context.textContent = ['quiz', 'palette', 'share'].includes(t.id) ? 'KRAS G12C · 6OIM' : 'KRAS · P01116';
      if (data) cleanup = PREVIEWS[t.id](body, data, () => { auto = false; sync(); }) ?? null;
      else body.innerHTML = '<div class="tk-loading">Loading Argus’s results…</div>';
      foot.innerHTML = `${data ? `<p class="tk-finding">${finding(t.id, data)}</p>` : ''}<p class="tk-line">${t.line}</p><span class="tk-source">${t.source}</span>`;
      replay(body);
      replay(foot);
      // on phones the tabs are a strip that scrolls sideways: keep the active one in view
      if (getComputedStyle(index).overflowX !== 'visible') index.scrollTo({ left: tabs[active].offsetLeft - 20, behavior: reduced ? 'auto' : 'smooth' });
    };
    const choose = i => { active = i; auto = false; sync(); render(); };
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => choose(i));
      b.querySelector('.tk-bar').addEventListener('animationend', () => { if (auto) { active = (active + 1) % TOOLS.length; render(); } });
    });
    index.addEventListener('keydown', e => {
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      choose((active + step + TOOLS.length) % TOOLS.length);
      tabs[active].focus();
    });
    toolkit.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { paused = true; sync(); } });
    toolkit.addEventListener('pointerleave', () => { paused = false; sync(); });
    new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync(); }, { threshold: 0.35 }).observe(toolkit);
    narrowQ.addEventListener('change', render);
    sync();
    render();
    fetch('/landing/data/kras-tools.json').then(r => r.json()).then(d => { data = d; render(); })
      .catch(() => { body.innerHTML = '<div class="tk-loading">The previews couldn’t load.</div>'; });
  }

  // ---------------- Validated: one answer through Argus's own check ----------------
  // Run on 1M17, EGFR kinase with erlotinib (groundingService: getStructureFacts, checkAnswer,
  // correctAnswer). The draft numbers EGFR the way papers do, by UniProt; the file numbers it 24 lower.
  const FACTS = [
    'Epidermal growth factor receptor [EGFR_HUMAN, UniProt P00533]: chain A, residues 672-995, file numbering = UniProt - 24',
    '- active site: A:Asp813 (Proton acceptor)',
    '- binds ATP: A:694-702, A:Lys721, A:Thr766, A:Gln767, A:Asp831',
    '…',
    'Ligands in the file: AQ4 ([6,7-bis(2-methoxy-ethoxy)quinazoli…) A:999',
    'Ligand interactions computed from this file (PLIP geometric criteria, hydrogens inferred): AQ4 A:999 — hydrogen bonds A:Met769 A:Gly772; water bridges A:Thr766; hydrophobic contacts A:Leu764 A:Thr766 A:Leu694 A:Lys721 A:Leu768',
  ];
  const ROWS = [
    { draft: 'Hinge Met793', at: 'A:793', problem: 'A:793 is Trp in this file, not Met', drawn: 'A:Met769', note: 'UniProt Met793 = A:Met769' },
    { draft: 'Gatekeeper Thr790', at: 'A:790', problem: 'A:790 is Leu in this file, not Thr', drawn: 'A:Thr766', note: 'UniProt Thr790 = A:Thr766' },
    { draft: 'Catalytic Lys745', at: 'A:745', problem: 'A:745 is Val in this file, not Lys', drawn: 'A:Lys721', note: 'UniProt Lys745 = A:Lys721' },
    { draft: 'DFG Asp855', at: 'A:855', problem: 'A:855 is Lys in this file, not Asp', drawn: 'A:Asp831', note: 'UniProt Asp855 = A:Asp831' },
    { draft: 'Erlotinib', at: 'A:999', problem: null, drawn: 'A:999', note: 'AQ4, where the draft put it' },
  ];
  const check = document.querySelector('[data-check]');
  if (check) {
    const N = ROWS.length;
    const BAD = ROWS.filter(r => r.problem).length;
    const DONE = 2 * N + 1; // -1 waiting · 0 facts in · 1..N checked · N+1..2N repaired · DONE
    // in the facts, every residue a repair lands on (and the numbering rule) is marked
    const RULE = 'UniProt - 24';
    const MARKS = [...new Set(ROWS.map(r => r.drawn)), RULE];
    const MARK_RE = new RegExp(`(${MARKS.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    check.querySelector('[data-ck-facts]').innerHTML = FACTS.map(line => `<p${line === '…' ? ' class="ck-gap"' : ''}>${line.split(MARK_RE).map(part => (MARKS.includes(part) ? `<mark data-mark="${esc(part)}">${esc(part)}</mark>` : esc(part))).join('')}</p>`).join('');
    const rowsEl = check.querySelector('[data-ck-rows]');
    rowsEl.innerHTML = ROWS.map(r => `<li class="ck-row ${r.problem ? 'is-bad' : 'is-ok'}"><span class="ck-draft"><b>${esc(r.draft)}</b><s>${esc(r.at)}</s></span><span class="ck-check"></span><span class="ck-fix"></span></li>`).join('');
    const items = [...rowsEl.children];
    const marks = [...check.querySelectorAll('mark[data-mark]')];
    const status = check.querySelector('[data-ck-status]');
    const again = check.querySelector('[data-ck-again]');
    let phase = -1, timer = 0, inView = false;
    const paint = () => {
      items.forEach((li, i) => {
        const r = ROWS[i];
        const checked = phase >= 1 + i, fixed = phase >= N + 1 + i;
        li.classList.toggle('is-checked', checked);
        li.classList.toggle('is-fixed', fixed);
        li.querySelector('.ck-check').innerHTML = checked
          ? (r.problem ? `<i class="ck-mark is-x">${CROSS}</i><span>${esc(r.problem)}</span>` : `<i class="ck-mark">${TICK}</i><span>In the file, as drafted</span>`)
          : phase === i ? DOTS : '<i class="ck-wait"></i>';
        li.querySelector('.ck-fix').innerHTML = fixed ? `<b>${TICK}${esc(r.drawn)}</b><em>${esc(r.note)}</em>` : phase === N + i ? DOTS : '';
      });
      const lit = new Set(ROWS.filter((r, i) => phase >= N + 1 + i).map(r => r.drawn));
      if (phase >= N + 1) lit.add(RULE);
      marks.forEach(m => m.classList.toggle('is-lit', lit.has(m.dataset.mark)));
      status.textContent = phase >= DONE ? `${BAD} slips found · ${BAD} repaired in the browser, without asking the AI again · checked again: 0 problems`
        : phase > N ? 'Repairing: reading the numbers as UniProt’s, through the SIFTS mapping…'
        : phase >= 0 ? 'Checking every highlight against the residues in 1M17…' : 'Waiting for the draft…';
      again.disabled = phase >= 0 && phase < DONE;
    };
    const run = () => {
      clearTimeout(timer);
      phase = -1;
      paint();
      if (reduced) { phase = DONE; paint(); return; }
      const tick = () => {
        phase++;
        paint();
        if (phase < DONE) timer = setTimeout(tick, phase === 0 ? 900 : phase === N ? 700 : phase < N ? 480 : 420);
      };
      timer = setTimeout(tick, 350);
    };
    // the check runs when its rows come into view (on a phone they sit below the facts), again each time
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !inView) { inView = true; run(); }
      else if (!e.isIntersecting && inView) { inView = false; clearTimeout(timer); phase = -1; paint(); }
    }, { threshold: 0.45 }).observe(rowsEl);
    again.addEventListener('click', run);
    // a repaired row points back at the line of facts that already had it
    const hot = key => {
      marks.forEach(m => m.classList.toggle('is-hot', m.dataset.mark === key));
      items.forEach((li, i) => li.classList.toggle('is-hot', ROWS[i].drawn === key));
    };
    items.forEach((li, i) => {
      li.addEventListener('pointerenter', () => hot(ROWS[i].drawn));
      li.addEventListener('pointerleave', () => hot(null));
    });
    paint();
  }
})();
