// The press lifecycle: resolvePress (pure) + mount (browser) + press (ergonomic wrapper).
//
// Liotta #3 — split config resolution from lifecycle. `resolvePress(opts, ctx) -> spec` is PURE:
// no DOM, no rAF, serializable, unit-testable in Node with no canvas (and the golden oracle hashes
// spec -> pixels). `mount(el, spec, ctx) -> handle` owns everything impure: the 2d context, the
// rAF run, the per-context registry entry, the generation token that makes destroy() safe. Nothing
// here touches window/document/rAF/matchMedia AT MODULE SCOPE, so the import stays SSR-safe (V-3);
// every browser API is referenced only inside mount() and the functions it returns, which run only
// after the caller hands us an element (which implies a browser). Blocker 4 dies.
//
// The caller owns the lifecycle. destroy() releases the rAF (via the generation token) and removes
// the surface from the context registry, killing blockers 1 (registry leak) and 5 (DOM scanning —
// there are none; the caller owns the element) at once.

import { grainPts, amPlates } from './screens.js';
import { mulberry32, makeNoise } from './rng.js';
import { drawPress, drawProcessAm } from './draw.js';
import { cmyk } from './color.js';
import { createPressContext } from './context.js';

// Resolve a press's `color` opt to a concrete CSS color at DRAW time (lazy — V-11). A function is a
// (ctx)=>color resolver; a string is a palette name, then an ink name, else a literal CSS color; a
// null/absent color falls to the theme foreground. drawPress itself sets no fillStyle — the docs'
// surface() wrapper set it before the loop (:3046), and mount() is that wrapper for the core.
function resolveColor(color, ctx) {
  if (typeof color === 'function') return color(ctx);
  if (typeof color === 'string') return ctx.palette(color) || ctx.ink(color) || color;
  return ctx.fore();
}

// ---- resolvePress: pure three-tier merge (instance opts -> context defaults -> built-ins) --------
// Structure resolves EAGERLY here (which tier wins). Color stays LAZY — `field` and any color
// getter close over ctx and resolve at draw (§4b). The returned spec is a plain data object.
export function resolvePress(opts = {}, ctx = null) {
  const g = ctx ? ctx.grain : { pattern: 'hatch', scale: 1, ink: 1, wash: 1 };
  return {
    field: opts.field,                    // (u,v) => 0..1 (or descriptor) — REQUIRED; normalized (§4a)
    screen: opts.screen || g.pattern,     // stipple | lines | waves | hatch | am
    scale: opts.scale ?? g.scale,
    ink: opts.ink ?? g.ink,
    wash: opts.wash ?? g.wash,
    r: opts.r ?? 2.5,                     // base pitch factor; grid pitch = r * 0.8 * scale (docs :3137)
    h: opts.h ?? null,                    // CSS height override; null = measure clientHeight
    seed: opts.seed ?? (ctx ? ctx.seed : 1859), // ENTRANCE transient seed (see roll for resting)
    // Per-press resting-geometry entropy. `null` (the default) means INHERIT the context's roll —
    // so a provider-level ctx.setRoll() re-presses every surface that didn't pin its own roll,
    // matching the "provider default all its surfaces share" contract (context.js). An explicit
    // number (incl. 0) OVERRIDES the context roll for that one surface. Resolved live in rebuild(),
    // not frozen here, so ctx.setRoll() after mount takes effect on the next rebuild()/repaint().
    roll: opts.roll ?? null,
    color: opts.color ?? null,            // fill ink: a CSS color, a palette/ink NAME, a (ctx)=>color
                                          // resolver, or null = the theme foreground (ctx.fore()).
                                          // Resolved LAZILY at draw (V-11), never frozen here.
    inks: opts.inks || null,              // ink SELECTION (names) frozen here; VALUES stay lazy (V-11)
    plates: opts.plates || null,          // explicit multi-plate stack (masthead/charts) — P2
    animate: opts.animate ?? false,       // press-in when the caller triggers it
    harmony: opts.harmony ?? false,       // per-instance (V-12)
    pressMs: opts.pressMs ?? 700,         // press-in duration
  };
}

// ---- mount: bind a spec to a real canvas and return the imperative handle ------------------------
export function mount(el, spec, ctx) {
  if (!ctx) ctx = createPressContext(); // standalone press -> its own isolated context (no global)

  // Per-surface state. `s` is what lives in the registry; the handle closes over it.
  const off = ctx.nextOff();            // decorrelation offset (docs seedTick += 313)
  const s = { el, pr: spec.animate ? 0 : 1, stale: false, dead: false, gen: 0, raf: 0 };

  // fit: size the backing store to dpr, install the transform, hand back the 2d context. Operates
  // ONLY on the caller's element — no DOM lookup (V-8). devicePixelRatio is read here, in a
  // browser-only function, never at import.
  function fit() {
    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    const w = el.clientWidth, h = spec.h ?? el.clientHeight;
    if (!w) return null;
    // Only reassign the backing store when the size actually changes. Setting el.width/height
    // reallocates and CLEARS the canvas, so doing it on every rebuild thrashes the buffer (the docs
    // guarded this the same way, :4758). s.draw clears explicitly, so an unchanged-size rebuild must
    // leave el.width alone or repeated repaints (theme/dial/palette) lose the last frame.
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (el.width !== bw || el.height !== bh) { el.width = bw; el.height = bh; }
    el.style.height = h + 'px';
    const g = el.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
  }

  // rebuild: recompute the point grid + noise field. Resting geometry derives from the context
  // base + decorrelation offset + the EFFECTIVE roll (NOT the entrance seed) so the resting frame is
  // seed-invariant. Effective roll = the per-press roll if pinned, else the live context roll
  // (`spec.roll ?? ctx.roll`) — read here, not frozen at resolve, so ctx.setRoll() + rebuild()
  // re-presses this surface. With both at 0 it reproduces docs `mulberry32(base + off)` byte-for-byte
  // (§7, V-4); ctx.base + off + ctx.roll is exactly ctx.seedValue + off.
  s.rebuild = () => {
    const f = fit();
    if (!f) { s.stale = true; return; }
    s.stale = false; s.g = f.g; s.W = f.w; s.H = f.h;
    const restSeed = ctx.base + off + (spec.roll ?? ctx.roll);
    const pitchR = spec.r * 0.8 * spec.scale;
    s.pts = grainPts(f.w, f.h, pitchR, mulberry32(restSeed), spec.screen);
    // am surfaces additionally carry the four process-plate lattices, generated ONCE at rebuild (not
    // per draw) so a colourful `am` fill can press as a real CMYK rosette (drawProcessAm). Same pitch
    // as grainPts('am'), so the process dots sit on the single-plate am grid.
    s.amPlates = spec.screen === 'am'
      ? amPlates(f.w, f.h, pitchR, (i) => mulberry32(restSeed + i * 977))
      : null;
    s.noise = makeNoise(restSeed);
  };

  // draw: the ONE press. Everything the field needs beyond (u,v) — the noise field, animation
  // state, geometry — the caller closes into `spec.field`; drawPress only ever asks field(u,v).
  s.draw = () => {
    if (s.stale || !s.g) return;
    s.g.clearRect(0, 0, s.W, s.H);
    const color = resolveColor(spec.color, ctx); // lazy ink — the docs' surface() wrapper (:3046)
    s.g.fillStyle = color;
    // A CHROMATIC am fill presses as a four-plate process rosette; an ACHROMATIC one (the default
    // foreground white/black, or any grey) has no process separation, so it stays the single-plate
    // am path — byte-identical to what this surface pressed before, and the honest print behaviour
    // (CMYK cannot reproduce white; black is the key plate alone).
    if (spec.screen === 'am' && s.amPlates) {
      const sep = cmyk(color);
      if (Math.max(sep.c, sep.m, sep.y) > 0.02) {
        drawProcessAm(s.g, {
          base: color, W: s.W, H: s.H, plates: s.amPlates, field: spec.field,
          grain: { ink: spec.ink, wash: spec.wash },
          misreg: ctx.grain.misreg ?? 1, paper: ctx.theme.mode, pr: s.pr,
          // pass THIS context's process inks (not module INKS) so a createPressContext({ inks })
          // override drives the rosette too — instance isolation, same as the rest of the press.
          inks: {
            yellow: ctx.ink('yellow'), blue: ctx.ink('blue'), pink: ctx.ink('pink'),
            black: ctx.ink('black'), white: ctx.ink('white'),
          },
        });
        return;
      }
    }
    drawPress(s.g, {
      pts: s.pts, W: s.W, H: s.H,
      field: spec.field, screen: spec.screen,
      grain: { ink: spec.ink, wash: spec.wash }, pr: s.pr, roll: spec.roll,
    });
  };

  // press-in: ramp pr 0->1 over ms, redrawing each frame. Generation-guarded so a destroy (or a
  // restart) mid-run stops the old rAF chain dead (V-7). reduced-motion / an un-fitted surface
  // snap straight to the resting frame.
  s.pressIn = (ms = spec.pressMs) => {
    const gen = ++s.gen;
    if (ctx.reduced || s.stale) { s.pr = 1; if (!s.stale) s.draw(); return; }
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const tick = (t) => {
      if (s.gen !== gen || s.dead) return;         // superseded or destroyed -> abandon the chain
      s.pr = Math.min(1, (t - t0) / ms);
      if (!s.stale) s.draw();
      if (s.pr < 1) s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
  };

  // set: merge a patch. Geometry-affecting keys force a rebuild; anything else just repaints.
  const GEOMETRY = ['screen', 'scale', 'r', 'h', 'roll'];
  s.set = (patch = {}) => {
    const structural = Object.keys(patch).some((k) => GEOMETRY.includes(k));
    Object.assign(spec, patch);
    if (structural) { s.rebuild(); s.draw(); } else { s.draw(); }
  };

  // proof: one flattened settled frame as a data URL. Forces pr to the resting value, rebuilds and
  // draws, then exports. Defined for v1 (§4b: define or cut — defined).
  s.proof = () => {
    s.pr = 1; s.rebuild(); s.draw();
    return el.toDataURL();
  };

  // destroy: idempotent release. Bumps the generation (any in-flight tick sees the mismatch),
  // cancels the pending frame, and drops out of the registry so ctx.size returns to baseline (V-2).
  s.destroy = () => {
    if (s.dead) return;
    s.dead = true; s.gen++;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(s.raf);
    ctx._remove(s);
  };

  ctx._add(s);
  s.rebuild();
  if (spec.animate) s.draw(); // paint the un-pressed frame; caller triggers pressIn() on reveal
  else s.draw();

  // The public handle — the imperative surface the spec (§4b) promises.
  return {
    draw: () => s.draw(),
    rebuild: () => { s.rebuild(); s.draw(); },
    set: (patch) => s.set(patch),
    pressIn: (ms) => s.pressIn(ms),
    proof: () => s.proof(),
    destroy: () => s.destroy(),
    get spec() { return spec; },
    get stale() { return s.stale; },
  };
}

// ---- press: the ergonomic default. mount(el, resolvePress(opts, ctx), ctx). ---------------------
export function press(el, opts = {}, ctx = null) {
  return mount(el, resolvePress(opts, ctx), ctx);
}
