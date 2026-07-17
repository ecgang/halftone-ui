// P2c-2 byte-oracle: prove drawPlates reproduces the ORIGINAL masthead ('batch') and inkSurface
// ('layer') draw loops op-for-op, BEFORE touching the 260KB docs. Mock 2d ctx records every op
// (fillStyle, gco, alpha, clear, path, arc, moveTo, fill, drawImage) so any divergence shows.
import { drawPlates, amRadius } from '../halftone-kit/core/index.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

function mockCtx(tag = 'main') {
  const ops = [];
  const o = {
    ops, _tag: tag,
    _fill: '#000', _gco: 'source-over', _ga: 1,
    get fillStyle() { return this._fill; },
    set fillStyle(v) { this._fill = v; ops.push(`fillStyle=${v}`); },
    get globalCompositeOperation() { return this._gco; },
    set globalCompositeOperation(v) { this._gco = v; ops.push(`gco=${v}`); },
    get globalAlpha() { return this._ga; },
    set globalAlpha(v) { this._ga = v; ops.push(`ga=${v}`); },
    clearRect(x, y, w, h) { ops.push(`clear ${x} ${y} ${w} ${h}`); },
    beginPath() { ops.push('bp'); },
    moveTo(x, y) { ops.push(`moveTo ${x.toFixed(5)} ${y.toFixed(5)}`); },
    arc(x, y, r) { ops.push(`arc ${x.toFixed(5)} ${y.toFixed(5)} ${r.toFixed(6)}`); },
    fill() { ops.push('fill'); },
    drawImage(cv, x, y, w, h) { ops.push(`drawImage ${cv._id} ${x} ${y} ${w} ${h}`); },
  };
  return o;
}
const mockLayer = () => { const c = mockCtx('layer'); c._id = 'LAYER'; c.canvas = { _id: 'LAYER' }; return c; };

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const INKS = { blue: '#1f6feb', orange: '#e8792b', white: '#F2EFE6', black: '#0B0C10' };

// ---------- shared synthetic scene ----------
const W = 220, H = 64;
// point set (mimics amPts: x,y,th) — includes points that should skip on various guards
const pts = [];
for (let i = 0; i < 40; i++) pts.push({ x: (i * 27) % (W + 8) - 4, y: ((i * 13) % (H + 8)) - 4, th: ((i * 7) % 100) / 100 });

// ================= MASTHEAD ('batch') =================
const PLATES = [
  { ink: 'blue', dx: 0.6, dy: -0.4, lx: 3.2, ly: 1.1, ang: 0.785, w: (u, v) => 0.4 + 0.5 * u },
  { ink: 'orange', dx: -0.5, dy: 0.3, lx: 2.0, ly: -0.8, ang: 1.309, w: (u, v) => 0.9 - 0.3 * v },
  { ink: null, dx: 0, dy: 0, lx: 1.4, ly: 0.6, ang: 0.0, w: (u, v) => 0.7 },
];
const SWEEP = 0.45;
const cell = 8.0;
// pixel-native luminance sampler; deliberately returns <0.02 for some points
const Tsample = (x, y, r) => clamp01(0.06 + 0.5 * Math.sin(x * 0.21 + y * 0.05) + 0.35 * (y / H) - 0.15 * Math.cos(r));

function mastReference(pr, mode, grainInk) {
  const ctx = mockCtx();
  const plates = PLATES.map((pl, i) => ({ pl, pts }));
  ctx.globalCompositeOperation = mode === 'dark' ? 'lighter' : 'multiply';
  for (let i = 0; i < plates.length; i++) {
    const { pl, pts } = plates[i];
    const pu = Math.min(1, Math.max(0, (pr - i * 0.12) / 0.64));
    const e = 1 - Math.pow(1 - pu, 3);
    const ox = pl.dx + (1 - e) * pl.lx, oy = pl.dy + (1 - e) * pl.ly;
    ctx.fillStyle = pl.ink ? INKS[pl.ink] : (mode === 'dark' ? INKS.white : INKS.black);
    ctx.beginPath();
    for (const p of pts) {
      const lum = Tsample(p.x - ox, p.y - oy, cell * 0.5);
      if (lum < 0.02) continue;
      const t = Math.min(0.92, lum * pl.w(p.x / W, p.y / H) * 1.2 * grainInk);
      if (t <= 0.012) continue;
      const q = Math.min(1, Math.max(0, (p.x / W) * 0.78 + p.th * 0.22));
      const ink = Math.min(1, Math.max(0, pu * (1 + SWEEP) - SWEEP * q));
      if (ink <= 0) continue;
      const r = cell * 0.56 * Math.sqrt(t * ink);
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, 6.283);
    }
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  return ctx.ops.join('|');
}

function mastCandidate(pr, mode, grainInk) {
  const ctx = mockCtx();
  const dark = mode === 'dark';
  const plates = PLATES.map((pl, i) => {
    const pu = Math.min(1, Math.max(0, (pr - i * 0.12) / 0.64));
    const e = 1 - Math.pow(1 - pu, 3);
    const ox = pl.dx + (1 - e) * pl.lx, oy = pl.dy + (1 - e) * pl.ly;
    return {
      ink: pl.ink ? INKS[pl.ink] : (dark ? INKS.white : INKS.black),
      pts,
      dot: (p) => {
        const lum = Tsample(p.x - ox, p.y - oy, cell * 0.5);
        if (lum < 0.02) return 0;
        const t = Math.min(0.92, lum * pl.w(p.x / W, p.y / H) * 1.2 * grainInk);
        if (t <= 0.012) return 0;
        const q = Math.min(1, Math.max(0, (p.x / W) * 0.78 + p.th * 0.22));
        const ink = Math.min(1, Math.max(0, pu * (1 + SWEEP) - SWEEP * q));
        if (ink <= 0) return 0;
        return amRadius(cell * 0.56, t * ink);
      },
    };
  });
  drawPlates(ctx, { composite: 'batch', gco: dark ? 'lighter' : 'multiply', plates });
  return ctx.ops.join('|');
}

for (const [pr, mode, gi] of [[1, 'dark', 1.1], [0.4, 'dark', 1.0], [0.7, 'light', 0.8], [1, 'light', 1.3]]) {
  ok(`masthead batch byte-identical (pr=${pr} ${mode} ink=${gi})`, mastReference(pr, mode, gi) === mastCandidate(pr, mode, gi));
}

// ================= INKSURFACE ('layer') =================
const iband = (x, lo, hi) => x <= lo ? 0 : x >= hi ? 1 : (x - lo) / (hi - lo);
const noise = { n: (x, y) => 0 };
const sig = (d) => d; // simplify; cov closures below use it identically on both sides
const field = (x, y, w, h, nz, st) => clamp01(0.1 + 0.7 * (x / w) + 0.25 * Math.sin(y * 0.3));
const screensOf = () => ([
  { color: INKS.orange, rmax: 3.1, ox: 1.0, oy: -0.4, cov: (d) => iband(sig(d), 0.06, 0.86) * 0.95, pts: pts.map(p => ({ ...p, j: (p.x * 0.017) % 1 })) },
  { color: INKS.blue, rmax: 3.1, ox: 0, oy: 0, cov: (d) => iband(sig(d), 0.42, 1.04), pts: pts.map(p => ({ ...p, j: (p.y * 0.023) % 1 })) },
]);

function inkReference(reveal, body, dk) {
  const ctx = mockCtx(); const layer = mockLayer(); const lctx = layer;
  const screens = screensOf();
  const k = dk ? 0 : body;
  const nsc = screens.length;
  for (let si = 0; si < nsc; si++) {
    const sc = screens[si];
    const rv = Math.max(0, Math.min(1, reveal * nsc - si));
    if (rv <= 0.01) continue;
    lctx.clearRect(0, 0, W, H);
    lctx.fillStyle = sc.color;
    for (const q of sc.pts) {
      const d = Math.max(0, Math.min(1, field(q.x, q.y, W, H, noise, {})));
      const c = sc.cov(d);
      if (c <= 0.02) continue;
      const r = sc.rmax * Math.sqrt(Math.min(1, c)) * (0.82 + 0.36 * q.j);
      lctx.beginPath(); lctx.arc(q.x + sc.ox, q.y + sc.oy, r, 0, 6.283); lctx.fill();
    }
    if (k > 0.02) { ctx.globalAlpha = k * rv; ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(lctx.canvas, 0, 0, W, H); }
    if (k < 0.98) { ctx.globalAlpha = (1 - k) * rv; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(lctx.canvas, 0, 0, W, H); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  return ctx.ops.join('|') + '###LAYER###' + lctx.ops.join('|');
}

function inkCandidate(reveal, body, dk) {
  const ctx = mockCtx(); const layer = mockLayer(); const lctx = layer;
  const k = dk ? 0 : body;
  const plates = screensOf().map(sc => ({
    color: sc.color, rmax: sc.rmax, ox: sc.ox, oy: sc.oy, pts: sc.pts,
    cov: (q) => sc.cov(Math.max(0, Math.min(1, field(q.x, q.y, W, H, noise, {})))),
  }));
  drawPlates(ctx, { composite: 'layer', lctx, W, H, reveal, k, plates });
  return ctx.ops.join('|') + '###LAYER###' + lctx.ops.join('|');
}

for (const [rev, body, dk] of [[1, 0.55, false], [0.4, 0.6, false], [1, 0.55, true], [0.02, 0.5, false]]) {
  ok(`inkSurface layer byte-identical (reveal=${rev} body=${body} dark=${dk})`, inkReference(rev, body, dk) === inkCandidate(rev, body, dk));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
