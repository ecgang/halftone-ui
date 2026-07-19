// P2c-2 byte-oracle: prove drawPlates reproduces the ORIGINAL masthead ('batch') and inkSurface
// ('layer') draw loops op-for-op, BEFORE touching the 260KB docs. Mock 2d ctx records every op
// (fillStyle, gco, alpha, clear, path, arc, moveTo, fill, drawImage) so any divergence shows.
import { drawPlates, amRadius, cmyk, drawProcessAm, amPlates, mulberry32, INKS as CORE_INKS } from '../halftone-kit/core/index.js';

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

// ================= CMYK SEPARATION (cmyk) =================
// The four-plate process press separates ANY resolved fill through cmyk(); resolveColor (press.js)
// can hand it 6-/3-digit hex, rgb()/rgba(), or a named/hsl/malformed string. These pin the edge
// vectors AND the deterministic (no-NaN) fallback that keeps an unreadable colour on the single-plate
// path instead of pressing NaN-radius plates.
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const cmykEq = (g, c, m, y, k) => near(g.c, c) && near(g.m, m) && near(g.y, y) && near(g.k, k);
ok('cmyk pure black #000000 -> key only', cmykEq(cmyk('#000000'), 0, 0, 0, 1));
ok('cmyk pure black short #000 -> key only', cmykEq(cmyk('#000'), 0, 0, 0, 1));
ok('cmyk white #ffffff -> no ink', cmykEq(cmyk('#ffffff'), 0, 0, 0, 0));
ok('cmyk white short #fff -> no ink', cmykEq(cmyk('#fff'), 0, 0, 0, 0));
ok('cmyk pure red -> m+y', cmykEq(cmyk('#ff0000'), 0, 1, 1, 0));
ok('cmyk pure green -> c+y', cmykEq(cmyk('#00ff00'), 1, 0, 1, 0));
ok('cmyk pure blue -> c+m', cmykEq(cmyk('#0000ff'), 1, 1, 0, 0));
ok('cmyk 3-hex #f00 equals 6-hex red', cmykEq(cmyk('#f00'), 0, 1, 1, 0));
ok('cmyk rgb() comma form', cmykEq(cmyk('rgb(255,0,0)'), 0, 1, 1, 0));
ok('cmyk rgb() space form', cmykEq(cmyk('rgb(0 255 0)'), 1, 0, 1, 0));
ok('cmyk rgba() ignores alpha', cmykEq(cmyk('rgba(0,0,255,0.5)'), 1, 1, 0, 0));
ok('cmyk mid-grey -> chroma-free (single-plate route)', (() => { const s = cmyk('#808080'); return near(s.c, 0) && near(s.m, 0) && near(s.y, 0) && s.k > 0.02; })());
ok('cmyk named colour -> deterministic zero-chroma fallback (no NaN)', cmykEq(cmyk('red'), 0, 0, 0, 0));
ok('cmyk hsl()/unparseable -> fallback', cmykEq(cmyk('hsl(200,50%,40%)'), 0, 0, 0, 0));
ok('cmyk empty/non-string -> fallback (no throw)', cmykEq(cmyk(''), 0, 0, 0, 0) && cmykEq(cmyk(null), 0, 0, 0, 0));
// malformed rgb() must hit the deterministic fallback, never NaN plates (public cmyk() contract)
ok('cmyk rgb bare-dot -> fallback (finite)', (() => { const s = cmyk('rgb(.,0,0)'); return cmykEq(s, 0, 0, 0, 0) && [s.c, s.m, s.y, s.k].every(Number.isFinite); })());
ok('cmyk rgb double-dot channel -> fallback', cmykEq(cmyk('rgb(1.2.3,0,0)'), 0, 0, 0, 0));
ok('cmyk rgb missing close paren -> fallback', cmykEq(cmyk('rgb(255,0,0'), 0, 0, 0, 0));
ok('cmyk rgb trailing garbage -> fallback', cmykEq(cmyk('rgb(255,0,0)junk'), 0, 0, 0, 0));
ok('cmyk rgb decimal channel still parses', cmykEq(cmyk('rgb(255.0,0,0)'), 0, 1, 1, 0));
ok('cmyk rgb() modern slash-alpha parses', cmykEq(cmyk('rgb(0 0 255 / 0.5)'), 1, 1, 0, 0));
// mixed comma/space separators are invalid CSS -> deterministic fallback, not chromatic
ok('cmyk rgb mixed sep (comma then space) -> fallback', cmykEq(cmyk('rgb(255, 0 0)'), 0, 0, 0, 0));
ok('cmyk rgb mixed sep (space then comma) -> fallback', cmykEq(cmyk('rgb(255 0, 0)'), 0, 0, 0, 0));
ok('cmyk rgb comma body + slash alpha -> fallback', cmykEq(cmyk('rgb(255,0,0 / 0.5)'), 0, 0, 0, 0));
ok('cmyk rgb space body + comma alpha -> fallback', cmykEq(cmyk('rgb(255 0 0, 0.5)'), 0, 0, 0, 0));
{ const s = cmyk(CORE_INKS.blue); ok('chromatic guard TRUE for an ink hex', Math.max(s.c, s.m, s.y) > 0.02); }
ok('chromatic guard FALSE for white/black/grey/named', ['#ffffff', '#000000', '#808080', 'red'].every((c) => { const s = cmyk(c); return Math.max(s.c, s.m, s.y) <= 0.02; }));

// ================= PROCESS-AM (drawProcessAm) =================
// State hygiene (V7) + per-context ink isolation (Codex finding 2). Reuses the mockCtx op recorder.
const procScene = (over = {}) => {
  const ctx = mockCtx();
  const plates = amPlates(W, H, 4, (i) => mulberry32(99 + i * 977));
  drawProcessAm(ctx, { base: '#cc3344', W, H, plates, field: () => 0.8, grain: { ink: 1, wash: 1 }, misreg: 1, paper: 'light', pr: 1, ...over });
  return ctx;
};
{ const ctx = procScene(); ok('drawProcessAm sets multiply on light paper', ctx.ops.includes('gco=multiply')); ok('drawProcessAm restores gco=source-over (normal, light)', ctx._gco === 'source-over' && ctx.ops[ctx.ops.length - 1] === 'gco=source-over'); }
{ const ctx = procScene({ paper: 'dark' }); ok('drawProcessAm sets lighter on dark paper', ctx.ops.includes('gco=lighter')); ok('drawProcessAm restores gco=source-over (normal, dark)', ctx._gco === 'source-over'); }
{ const ctx = mockCtx(); const plates = amPlates(W, H, 4, (i) => mulberry32(7 + i * 977)); let threw = false;
  try { drawProcessAm(ctx, { base: '#3377cc', W, H, plates, field: () => { throw new Error('boom'); }, grain: {}, misreg: 1, paper: 'light', pr: 1 }); } catch { threw = true; }
  ok('drawProcessAm rethrows a throwing field', threw);
  ok('drawProcessAm restores gco=source-over even when the field throws (finally)', ctx._gco === 'source-over'); }
{ const ctx = procScene({ inks: { yellow: '#111111', blue: '#123456', pink: '#654321', black: '#222222', white: '#eeeeee' } });
  ok('drawProcessAm uses per-context inks (custom blue plate)', ctx.ops.includes('fillStyle=#123456'));
  ok('drawProcessAm does NOT fall back to module INKS.blue when overridden', !ctx.ops.includes(`fillStyle=${CORE_INKS.blue}`)); }
ok('drawProcessAm defaults to module INKS when no override given', procScene().ops.includes(`fillStyle=${CORE_INKS.blue}`));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
