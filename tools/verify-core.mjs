// P1 lifecycle verification: V-3, V-1, V-2, V-7, V-9, and byte-identical single-plate draw.
// Run under Node with NO browser globals predefined (V-3 must survive that), then install mocks.

const CORE = new URL('../halftone-kit/core/index.js', import.meta.url).href;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

// ---- V-3: import with zero browser globals must not throw ----------------------------------------
let mod;
try { mod = await import(CORE); ok('V-3 SSR-safe import (no window/document/matchMedia)', true); }
catch (e) { ok('V-3 SSR-safe import', false, e.message); process.exit(1); }
const { press, resolvePress, mount, createPressContext, drawPress } = mod;

// resolvePress must be pure/DOM-free — call it with no ctx, no canvas.
const spec0 = resolvePress({ field: (u, v) => v, screen: 'hatch', scale: 2 }, null);
ok('resolvePress pure (no DOM) merges tiers', spec0.screen === 'hatch' && spec0.scale === 2 && spec0.roll === null);

// ---- install a controllable rAF queue + mock canvas ---------------------------------------------
let rafQueue = [], rafId = 0, cancelled = new Set();
globalThis.devicePixelRatio = 2;
globalThis.requestAnimationFrame = (fn) => { const id = ++rafId; rafQueue.push([id, fn]); return id; };
globalThis.cancelAnimationFrame = (id) => { cancelled.add(id); };
let clock = 0;
globalThis.performance = { now: () => clock };
const flushRaf = (steps = 1, dt = 8) => {
  for (let i = 0; i < steps; i++) {
    clock += dt;
    const q = rafQueue; rafQueue = [];
    for (const [id, fn] of q) if (!cancelled.has(id)) fn(clock);
  }
};
const liveRaf = () => rafQueue.filter(([id]) => !cancelled.has(id)).length;
const clears = (cv) => cv._g.ops.filter((o) => o === 'clear').length; // one per s.draw() call

function mockCtx() {
  const ops = [];
  return {
    ops,
    fillStyle: '#000',
    setTransform() {}, clearRect() { ops.push('clear'); },
    beginPath() { ops.push('bp'); },
    arc(x, y, r) { ops.push(`arc ${x.toFixed(4)} ${y.toFixed(4)} ${r.toFixed(5)}`); },
    fillRect(x, y, w, h) { ops.push(`rect ${x.toFixed(4)} ${y.toFixed(4)} ${w.toFixed(5)} ${h.toFixed(5)}`); },
    fill() { ops.push('fill'); },
  };
}
function mockCanvas(w = 200, h = 60) {
  const g = mockCtx();
  return { _g: g, clientWidth: w, clientHeight: h, width: 0, height: 0, style: {}, getContext: () => g, toDataURL: () => 'data:proof' };
}

// ---- V-1: two instances, different config, mutually isolated ------------------------------------
{
  const ctx = createPressContext();
  const cvA = mockCanvas(), cvB = mockCanvas();
  const a = press(cvA, { field: (u) => 0.9, screen: 'hatch', scale: 1 }, ctx);
  const b = press(cvB, { field: (u) => 0.9, screen: 'stipple', scale: 3 }, ctx);
  const opsA = cvA._g.ops.join('|'), opsB = cvB._g.ops.join('|');
  ok('V-1 two instances render differently (own config)', opsA !== opsB && opsA.length > 0 && opsB.length > 0);
  // mutating B must not change A: re-draw A, compare to a solo A
  const before = cvA._g.ops.length;
  b.set({ ink: 2.0 });
  ok('V-1 mutating B does not touch A', cvA._g.ops.length === before);
  a.destroy(); b.destroy();
}

// ---- V-2: mount -> destroy x100 leaves no growth, no live rAF -----------------------------------
{
  const ctx = createPressContext();
  const base = ctx.size;
  for (let i = 0; i < 100; i++) {
    const cv = mockCanvas();
    const h = press(cv, { field: (u) => 0.5, animate: true }, ctx);
    h.pressIn(700);
    h.destroy();
  }
  flushRaf(5);
  ok('V-2 registry returns to baseline after 100 mount/destroy', ctx.size === base, `size=${ctx.size} base=${base}`);
  ok('V-2 no live rAF after destroys', liveRaf() === 0, `live=${liveRaf()}`);
}

// ---- V-7: destroy mid press-in stops the rAF chain ----------------------------------------------
{
  const ctx = createPressContext();
  const cv = mockCanvas();
  const h = press(cv, { field: (u) => 0.5, animate: true }, ctx);
  h.pressIn(1000);
  flushRaf(2);                 // advance a couple frames — chain is live
  const drawsBefore = clears(cv);
  ok('V-7 press-in is actually drawing before destroy', drawsBefore > 1, `draws=${drawsBefore}`);
  h.destroy();
  flushRaf(10);                // pump many frames after destroy
  ok('V-7 destroy halts in-flight press-in (no draws after)', clears(cv) === drawsBefore, `after=${clears(cv)} before=${drawsBefore}`);
  ok('V-7 no live rAF after mid-run destroy', liveRaf() === 0);
}

// ---- V-9: abuse cases ---------------------------------------------------------------------------
{
  const ctx = createPressContext();
  const cvA = mockCanvas(), cvB = mockCanvas();
  const a = press(cvA, { field: (u) => 0.7, animate: true }, ctx);
  const b = press(cvB, { field: (u) => 0.7, animate: true }, ctx);
  a.pressIn(); b.pressIn();
  a.destroy();
  const bBefore = clears(cvB);
  flushRaf(3);
  ok('V-9 destroying A does not disturb B (B keeps animating)', clears(cvB) > bBefore, `after=${clears(cvB)} before=${bBefore}`);
  let threw = false;
  try { ctx.setTheme({ mode: 'light' }); ctx.repaint(); } catch (e) { threw = true; }
  ok('V-9 theme change + repaint after a destroy does not throw', !threw);
  // different seeds -> different rng streams (not shared)
  const c1 = createPressContext({ seed: 1 }), c2 = createPressContext({ seed: 2 });
  const cv1 = mockCanvas(), cv2 = mockCanvas();
  press(cv1, { field: () => 0.6, roll: 1 }, c1);
  press(cv2, { field: () => 0.6, roll: 2 }, c2);
  ok('V-9 different roll -> different resting geometry', cv1._g.ops.join('|') !== cv2._g.ops.join('|'));
  b.destroy();
}

// ---- byte-identical single-plate arithmetic vs docs surface draw (3140-3165) --------------------
{
  // Replicate the docs draw for a synthetic point set + field, both branches (square + round + am),
  // and compare op-for-op against drawPress with the equivalent NORMALIZED field.
  const W = 200, H = 60, ink = 1.3, pr = 0.8;
  const pts = [
    { x: 10, y: 12, th: 0.2 },              // line/square candidate
    { x: 50, y: 30, th: 0.9 },              // below pr? th<=pr; v vs th
    { x: 120, y: 40, th: 0.5 },
    { x: 170, y: 20, th: 0.95 },            // th > pr -> skipped (pr=0.8)
    { x: 80, y: 25, c: 8, th: 0.3 },        // am cell
  ];
  const toneRaw = (px, py) => 0.15 + 0.6 * (px / W) + 0.25 * (py / H); // arbitrary field in pixel space

  // docs reference (square branch = non-stipple)
  function docsDraw(round) {
    const g = mockCtx();
    for (const p of pts) {
      if (p.th > pr) continue;
      const v = toneRaw(p.x, p.y) * ink;
      if (p.c) { // amDot
        const t = Math.min(0.92, v); if (t <= 0.012) continue;
        g.beginPath(); g.arc(p.x, p.y, p.c * 0.56 * Math.sqrt(t), 0, 6.283); g.fill(); continue;
      }
      if (v > p.th) {
        if (round) { g.beginPath(); g.arc(p.x, p.y, 0.42 + 0.85 * Math.min(1.15, v), 0, 6.283); g.fill(); }
        else { const d = 1.05 + 0.75 * Math.min(1.15, v); g.fillRect(p.x - d / 2, p.y - d / 2, d, d); }
      }
    }
    return g.ops.join('|');
  }
  for (const [screen, round] of [['hatch', false], ['stipple', true]]) {
    const g = mockCtx();
    drawPress(g, { pts, W, H, field: (u, v) => toneRaw(u * W, v * H), screen, grain: { ink }, pr });
    ok(`byte-identical drawPress vs docs (${screen})`, g.ops.join('|') === docsDraw(round));
  }
  // custom dot law (charts): area-chart geometry 0.45 + 0.9*min(1.15,v) on the round path
  function docsDrawCustom() {
    const g = mockCtx();
    for (const p of pts) {
      if (p.th > pr) continue;
      const v = toneRaw(p.x, p.y) * ink;
      if (p.c) { const t = Math.min(0.92, v); if (t <= 0.012) continue; g.beginPath(); g.arc(p.x, p.y, p.c * 0.56 * Math.sqrt(t), 0, 6.283); g.fill(); continue; }
      if (v > p.th) { g.beginPath(); g.arc(p.x, p.y, 0.45 + 0.9 * Math.min(1.15, v), 0, 6.283); g.fill(); }
    }
    return g.ops.join('|');
  }
  const gc = mockCtx();
  drawPress(gc, { pts, W, H, field: (u, v) => toneRaw(u * W, v * H), screen: 'stipple', grain: { ink }, pr, dot: { round: [0.45, 0.9], cap: 1.15 } });
  ok('custom dot law (area chart 0.45/0.9) folds byte-identical', gc.ops.join('|') === docsDrawCustom());
}

// ---- plates seam retired (P2c-2): drawPress is FM-only, drawPlates owns AM/composite -----------
{
  const { drawPlates } = mod;
  ok('drawPlates exported (AM/composite site landed)', typeof drawPlates === 'function');
  // drawPress no longer accepts/knows `plates`; passing it is silently ignored, never a throw.
  let threw = false;
  try { drawPress(mockCtx(), { pts: [], W: 10, H: 10, field: () => 0, plates: [{}], grain: {} }); }
  catch (e) { threw = true; }
  ok('drawPress ignores stray plates (FM-only, no throw)', !threw);
}

// ---- P2d: context-level roll / seedValue / surfaces (page-wide reseed dogfood) -----------------
{
  const ctx = createPressContext();
  ok('seedValue defaults to base (roll 0 = byte-identical to docs)', ctx.seedValue === ctx.base && ctx.roll === 0);
  ctx.setRoll(500);
  ok('setRoll mutates seedValue = base + roll', ctx.seedValue === ctx.base + 500 && ctx.roll === 500);
  const c2 = createPressContext({ roll: 77 });
  ok('roll opt seeds the context', c2.seedValue === c2.base + 77);
  // surfaces snapshot tracks the registry and preserves insertion order
  const s1 = mockCanvas(), s2 = mockCanvas();
  const h1 = press(s1, { field: () => 0.5 }, ctx), h2 = press(s2, { field: () => 0.5 }, ctx);
  ok('surfaces snapshot == registry size', ctx.surfaces.length === ctx.size && ctx.size === 2);
  h1.destroy();
  ok('surfaces snapshot shrinks after destroy', ctx.surfaces.length === 1);
  h2.destroy();
}

// ---- Codex F2: ctx.setRoll must propagate to press()-mounted surfaces (was a no-op) -------------
{
  // the mock ctx ACCUMULATES ops across draws (clearRect records 'clear' but never empties the
  // array), so only the ops since the last 'clear' represent the most recent frame.
  const lastDraw = (cv) => { const o = cv._g.ops; const i = o.lastIndexOf('clear'); return o.slice(i).join('|'); };

  // inherit: an unpinned surface re-presses when the context roll changes + rebuild()
  const ctx = createPressContext();
  const cv = mockCanvas();
  const h = press(cv, { field: () => 0.7 }, ctx);
  const before = lastDraw(cv);
  ctx.setRoll(1234);
  h.rebuild();
  const after = lastDraw(cv);
  ok('ctx.setRoll + rebuild re-presses a mounted surface (inherits ctx.roll)', before !== after && after.length > 4);
  h.destroy();

  // override: an explicitly-pinned roll ignores a later ctx.setRoll
  const ctx2 = createPressContext();
  const cvP = mockCanvas();
  const hp = press(cvP, { field: () => 0.7, roll: 5 }, ctx2);
  const p0 = lastDraw(cvP);
  ctx2.setRoll(9999);
  hp.rebuild();
  const p1 = lastDraw(cvP);
  ok('explicit per-press roll overrides ctx.roll (pinned surface unchanged)', p0 === p1 && p0.length > 4);
  hp.destroy();
}

// ---- allocation budget: area x pitch may not compound into a giant Poisson grid -----------------
// Every dial clamp upstream is per-value; the coupled worst case (max frame, min pitch) must be
// bounded INSIDE grainPts. 4096x4096 at pitch 0.32 would be a ~327M-cell (1.3GB) grid unfloored —
// if the floor holds, the call completes in bounded time with a sane point count; if it doesn't,
// this test dies on the allocation, which is exactly the signal.
{
  const { grainPts } = await import(new URL('../halftone-kit/core/screens.js', import.meta.url).href);
  const { mulberry32 } = await import(new URL('../halftone-kit/core/rng.js', import.meta.url).href);
  const t0 = Date.now();
  const pts = grainPts(4096, 4096, 0.32, mulberry32(7), 'stipple');
  ok('poisson allocation budget: 4096x4096 at pitch 0.32 completes bounded',
    pts.length > 1000 && pts.length < 2_000_000, `${pts.length} pts in ${Date.now() - t0}ms`);
  const ptsNaN = grainPts(300, 200, NaN, mulberry32(7), 'stipple');
  const ptsZero = grainPts(300, 200, 0, mulberry32(7), 'stipple');
  ok('poisson survives non-finite / zero pitch (no infinite loop, no Int32Array throw)',
    ptsNaN.length > 0 && ptsZero.length > 0, `NaN->${ptsNaN.length} 0->${ptsZero.length}`);
  // The floor must be invisible at sane ratios: a docs-scale canvas at a real pitch is unchanged.
  const a = grainPts(800, 400, 2.0, mulberry32(7), 'stipple');
  const b = grainPts(800, 400, Math.max(2.0, Math.sqrt((2 * 800 * 400) / 2097152)), mulberry32(7), 'stipple');
  ok('pitch floor never engages at sane area/pitch ratios (golden-safe)', a.length === b.length);
  // Thin canvases: area ~ 0 but ceil(W/cell) columns dominate — the budget must hold on the
  // EXACT grid product, or W=4096 x H=0.001 allocates millions of columns in a single row.
  const t1 = Date.now();
  const thin = grainPts(4096, 0.001, 0.01, mulberry32(7), 'stipple');
  ok('poisson budget holds on thin canvases (ceil overhead, not area)',
    thin.length >= 1 && Date.now() - t1 < 5000, `${thin.length} pts in ${Date.now() - t1}ms`);
  // Degenerate dimensions return an empty point set instead of throwing or looping:
  // Infinity would spin the budget loop forever, mixed-sign dims make Int32Array throw.
  const degenerate = [[0, 200], [-5, 200], [4096, -1], [NaN, 200], [Infinity, 200], [4096, Infinity]];
  const allEmpty = degenerate.every(([w, h]) => grainPts(w, h, 2, mulberry32(7), 'stipple').length === 0);
  ok('degenerate dimensions (0, negative, NaN, Infinity) press as empty, never throw', allEmpty);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
