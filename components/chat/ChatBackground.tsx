import React, { useEffect, useRef } from 'react';
import type { ChatBackground as Kind } from './chatLook';

// --- CHAT BACKGROUNDS ---
// Behind the conversation, never in front of it: each takes its colour from the theme's ink, sits at
// low contrast, and stops moving for people who ask for reduced motion.

// Fine grain, as an SVG noise tile (no image request)
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

// A honeycomb of bonds and atoms, like a sheet of rings: flat-topped hexagons with edge r = 14 px.
// One tile is 3r wide and 2h tall (h = r·√3/2); it is used as a mask so the theme colours it.
const R = 14;
const H = (R * Math.sqrt(3)) / 2;
const TILE_W = 3 * R;
const TILE_H = 2 * H;
const latticeTile = () => {
  const p = (x: number, y: number) => `${(x).toFixed(2)} ${(y).toFixed(2)}`;
  const segments = [
    [[2.5 * R, H], [2 * R, 2 * H]], [[2 * R, 2 * H], [R, 2 * H]], [[R, 2 * H], [0.5 * R, H]],
    [[0.5 * R, H], [R, 0]], [[R, 0], [2 * R, 0]], [[2 * R, 0], [2.5 * R, H]],
    [[2.5 * R, H], [3 * R, H]], [[0, H], [0.5 * R, H]],
  ];
  const nodes = [[R, 0], [2 * R, 0], [0.5 * R, H], [2.5 * R, H], [R, 2 * H], [2 * R, 2 * H]];
  const lines = segments.map(([a, b]) => `M${p(a[0], a[1])}L${p(b[0], b[1])}`).join('');
  const dots = nodes.map(([x, y]) => `<circle cx='${x.toFixed(2)}' cy='${y.toFixed(2)}' r='1.35'/>`).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${TILE_W}' height='${TILE_H.toFixed(3)}' viewBox='0 0 ${TILE_W} ${TILE_H.toFixed(3)}'><path d='${lines}' stroke='black' stroke-width='0.7' fill='none'/>${dots}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
const LATTICE = latticeTile();

/** Drifting points that join when they come close: the dotted orbs' constellation, at room scale. */
const Constellation: React.FC<{ strength: number }> = ({ strength }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    let points: { x: number; y: number; vx: number; vy: number }[] = [];
    let ink = '228 228 231';
    const readInk = () => { ink = getComputedStyle(document.documentElement).getPropertyValue('--c-ink').trim() || ink; };
    const seed = () => {
      const count = Math.max(22, Math.min(70, Math.round((w * h) / 9000)));
      points = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.12,
      }));
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      draw();
    };
    const LINK = 96;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        for (let j = i + 1; j < points.length; j++) {
          const b = points[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > LINK) continue;
          ctx.strokeStyle = `rgb(${ink} / ${((1 - d / LINK) * 0.22 * strength).toFixed(3)})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      ctx.fillStyle = `rgb(${ink} / ${(0.55 * strength).toFixed(3)})`;
      for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.15, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    let frame = 0;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || t - last < 33) return; // ~30 fps is plenty for a drift
      last = t;
      if (++frame % 120 === 0) readInk();
      for (const p of points) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
      }
      draw();
    };
    readInk();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (!reduce) raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, [strength]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full" aria-hidden="true" />;
};

const ChatBackground: React.FC<{ kind: Kind; strength: number }> = ({ kind, strength }) => {
  if (kind === 'none' || strength <= 0) return null;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" data-chat-background={kind}>
      {kind === 'spotlight' && (
        <>
          <div className="absolute inset-0" style={{ opacity: strength, background: 'radial-gradient(130% 75% at 50% -12%, rgb(var(--c-ink-strong) / 0.085), transparent 62%)' }} />
          <div className="absolute inset-0 mix-blend-overlay" style={{ opacity: 0.06 * strength, backgroundImage: GRAIN }} />
        </>
      )}

      {kind === 'dots' && (
        <div
          className="absolute inset-0"
          style={{
            opacity: strength,
            backgroundImage: 'radial-gradient(rgb(var(--c-ink) / 0.2) 1px, transparent 1.3px)',
            backgroundSize: '18px 18px',
            maskImage: 'radial-gradient(ellipse 95% 70% at 50% 25%, black 25%, transparent 85%)',
            WebkitMaskImage: 'radial-gradient(ellipse 95% 70% at 50% 25%, black 25%, transparent 85%)',
          }}
        />
      )}

      {kind === 'lattice' && (
        // Outer layer fades the lattice out towards the edges; the inner one drifts by exactly one tile
        <div
          className="absolute inset-0"
          style={{
            opacity: strength,
            maskImage: 'radial-gradient(ellipse 90% 75% at 50% 30%, black 20%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(ellipse 90% 75% at 50% 30%, black 20%, transparent 80%)',
          }}
        >
          <div
            className="absolute argus-lattice"
            style={{
              inset: `-${TILE_H.toFixed(2)}px -${TILE_W}px`,
              backgroundColor: 'rgb(var(--c-ink) / 0.16)',
              maskImage: LATTICE,
              WebkitMaskImage: LATTICE,
              maskSize: `${TILE_W}px ${TILE_H.toFixed(3)}px`,
              WebkitMaskSize: `${TILE_W}px ${TILE_H.toFixed(3)}px`,
              ['--tile-w' as string]: `${TILE_W}px`,
              ['--tile-h' as string]: `${TILE_H.toFixed(3)}px`,
            }}
          />
        </div>
      )}

      {kind === 'aurora' && (
        <div className="absolute inset-0" style={{ opacity: strength }}>
          <div className="absolute -bottom-[30%] -left-[20%] w-[90%] h-[65%] rounded-full argus-aurora-a" style={{ background: 'radial-gradient(closest-side, rgb(255 138 61 / 0.30), transparent)', filter: 'blur(40px)' }} />
          <div className="absolute -bottom-[35%] -right-[25%] w-[95%] h-[70%] rounded-full argus-aurora-b" style={{ background: 'radial-gradient(closest-side, rgb(139 92 246 / 0.32), transparent)', filter: 'blur(44px)' }} />
          <div className="absolute -top-[25%] right-[-30%] w-[80%] h-[50%] rounded-full argus-aurora-a" style={{ background: 'radial-gradient(closest-side, rgb(59 130 246 / 0.14), transparent)', filter: 'blur(48px)' }} />
          <div className="absolute inset-0 mix-blend-overlay" style={{ opacity: 0.05, backgroundImage: GRAIN }} />
        </div>
      )}

      {kind === 'constellation' && <Constellation strength={strength} />}
    </div>
  );
};

export default ChatBackground;
