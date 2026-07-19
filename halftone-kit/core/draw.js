// drawPress — the ONE tone->radius site the whole engine funnels through (V-5). Every surface in
// the docs (buttons, washes, meters, tabs, charts, masthead) reimplemented this loop; here it is
// once. It reproduces the docs engine's generic surface draw (docs/index.html:3140-3165) exactly,
// so a rebuilt surface stays byte-identical under the golden (V-4).
//
// The field contract is NORMALIZED: `field(u, v)` takes u,v in [0,1]^2, NOT device pixels (§4a).
// That is what lets a field author write size-portable math that survives retina/4K — drawPress
// owns the p.x/W, p.y/H division so the caller never sees a pixel. `field` is either a scalar
// closure or an escalation descriptor { sample, sampleInto?, resolution?, bounds? }; the descriptor
// shape is plumbed here in P1 so the acceleration path can land later WITHOUT touching this site
// again (the whole reason it is in the signature now — see §4a risk note).
//
// A THIRD arg — the raw screen point `p` — is passed after (u, v) as a PIXEL-EXACT escape hatch.
// New fields should ignore it and stay normalized. But two callers need exact pixels for byte
// identity: legacy tone closures whose math is written in device space (recovering p.x via u*W is
// not FP-exact and would flip dot radii, failing the golden), and pixel-native samplers like the
// masthead's text-luminance `T.sample(px, py, r)`. `p` gives them p.x/p.y with zero round-trip.
//
// The dispatch, point by point (single-plate / mono press):
//   press-in gate : a point inks only once the run has reached its threshold (p.th <= pr)
//   am (p.c)      : amplitude — the cell carries tone, sqrt radius, no threshold (amDot)
//   stipple       : a round dot, radius 0.42 + 0.85*min(1.15, v)
//   line family   : a square dot, side 1.05 + 0.75*min(1.15, v)  (hatch/lines/waves)
// Every non-am screen thresholds the near-fixed dot against the point's own value (v > p.th) —
// that FM threshold is what makes a line screen a line screen.

import { amDot, amRadius } from './screens.js';
import { cmyk, INKS } from './color.js';

// The FM dot geometry: a near-fixed mark whose size eases with the field value. Different surfaces
// legitimately want different dot weights (a chart reads better with a heavier dot than a button),
// so the law is a per-call parameter, not a constant — `radius = base + span*min(cap, v)`. These
// defaults reproduce the generic surface (docs:3152/3161) exactly; the charts pass their own.
export const DOT = { round: [0.42, 0.85], square: [1.05, 0.75], cap: 1.15 };

// Resolve `field` (scalar closure OR escalation descriptor) to a plain (u, v) -> 0..1 sampler.
// P1 implements the correctness path only (scalar, or the descriptor's own `.sample`); the bulk
// `sampleInto` / coarse-`resolution` fast paths are a later, golden-verified optimization that
// slots in here without changing the call site. A missing field reads as no ink.
export function fieldSampler(field) {
  if (typeof field === 'function') return field;
  if (field && typeof field.sample === 'function') return field.sample;
  return () => 0;
}

// drawPress(ctx, spec):
//   pts    : the screen points (pixel x,y; p.th press-in order; p.c set = am cell size)
//   W, H   : the surface's CSS pixel size, so drawPress can normalize p.x/W, p.y/H
//   field  : (u,v) => 0..1  BEFORE the ink dial — REQUIRED (scalar or descriptor)
//   screen : stipple | lines | waves | hatch | am  (falsy = stipple)
//   grain  : { ink } render dials; drawPress applies grain.ink to the field value
//   pr     : press-in progress 0..1 (the entrance transient; 1 = fully pressed / resting frame)
//   roll   : resting-geometry entropy — consumed at point generation (mount/rebuild), accepted
//            here for signature stability across the 4->1 collapse (§4a); the draw loop is
//            seed/roll-invariant given its pts.
export function drawPress(ctx, { pts, W, H, field, screen, grain = {}, pr = 1, roll = 0, dot = null }) {
  const ink = grain.ink ?? 1;
  // wash is the field-tone dial (docs wash surfaces scale by it); default 1 keeps every existing
  // caller bit-identical (IEEE-754: v * 1 === v exactly for every finite v).
  const wash = grain.wash ?? 1;
  const d = dot ? { ...DOT, ...dot } : DOT;   // merge so a caller can override just `round` or `cap`
  const [rb, rs] = d.round, [sb, ss] = d.square, cap = d.cap;

  const sample = fieldSampler(field);
  const round = !screen || screen === 'stipple';
  for (const p of pts) {
    if (p.th > pr) continue;
    const v = sample(p.x / W, p.y / H, p) * ink * wash;
    if (p.c) { amDot(ctx, p, v); continue; }
    if (v > p.th) {
      if (round) {
        ctx.beginPath(); ctx.arc(p.x, p.y, rb + rs * Math.min(cap, v), 0, 6.283); ctx.fill();
      } else {
        const side = sb + ss * Math.min(cap, v);
        ctx.fillRect(p.x - side / 2, p.y - side / 2, side, side);
      }
    }
  }
}

// drawPlates — the AM/composite press: the second (and last) tone->radius site in core (V-5, the
// AM half; drawPress is the FM half). A stack of ink plates, each a lattice of amplitude dots
// (radius via `amRadius`), composited. The two composite strategies the engine uses both live
// here — nowhere else — so no surface reimplements a plate loop:
//
//   'batch'  (masthead)  — every dot of a plate is one path, filled once under a global
//                          composite (lighter on a dark ground so overlaps add light, multiply on
//                          paper so they darken). Filling once per plate is load-bearing: per-dot
//                          fills would double-composite a plate's own overlaps and it would no
//                          longer be pixel-equal to the shipped masthead.
//   'layer'  (Studio)    — each plate is rendered to its own offscreen `lctx`, then drawn onto the
//                          page twice (a `multiply` pass at ink `k`, a `source-over` pass at 1-k)
//                          scaled by the plate's `reveal` — a real overprint that presses in order.
//
// drawPlates owns only the LOOP and the COMPOSITE. Everything surface-specific — where a dot
// samples its tone, the entrance sweep/ease, misregistration offsets, the ink color — is resolved
// by the caller into pure per-plate closures (`dot(p) -> radius|0`, `cov(q) -> coverage`) and the
// resolved plate fields. That keeps the AM law + compositing in one place while the DOM/theme/
// animation state stays out of core (V-6/V-8). Each mode is byte-identical to the loop it replaced.
//
// spec (batch): { composite:'batch', gco, plates:[{ ink, pts, dot(p)->r|0 }] }
// spec (layer): { composite:'layer', lctx, W, H, reveal, k, plates:[{ color, pts, ox, oy, rmax, cov(q)->c }] }
export function drawPlates(ctx, spec) {
  if (spec.composite === 'layer') {
    const { plates, lctx, W, H, reveal = 1, k } = spec;
    const nsc = plates.length;
    for (let si = 0; si < nsc; si++) {
      const sc = plates[si];
      const rv = Math.max(0, Math.min(1, reveal * nsc - si)); // plates print in press order
      if (rv <= 0.01) continue;
      lctx.clearRect(0, 0, W, H);
      lctx.fillStyle = sc.color;
      for (const q of sc.pts) {
        const c = sc.cov(q);
        if (c <= 0.02) continue;
        const r = amRadius(sc.rmax, Math.min(1, c), 0.82 + 0.36 * q.j);
        lctx.beginPath(); lctx.arc(q.x + sc.ox, q.y + sc.oy, r, 0, 6.283); lctx.fill();
      }
      if (k > 0.02) { ctx.globalAlpha = k * rv; ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(lctx.canvas, 0, 0, W, H); }
      if (k < 0.98) { ctx.globalAlpha = (1 - k) * rv; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(lctx.canvas, 0, 0, W, H); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    return;
  }
  // 'batch' — one path per plate, filled once under the shared composite.
  ctx.globalCompositeOperation = spec.gco;
  for (const plate of spec.plates) {
    ctx.fillStyle = plate.ink;
    ctx.beginPath();
    for (const p of plate.pts) {
      const r = plate.dot(p);
      if (!(r > 0)) continue;
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, 6.283);
    }
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// drawProcessAm — render an arbitrary base colour as a four-plate CMYK amplitude-modulation rosette.
// This is to a generic `am` surface what drawPlates('batch') is to the masthead: the masthead hand-
// authors its four plates; here the four plates fall straight out of a colour's process separation
// (color.js `cmyk`), so ANY fill — a chart series, a wash — presses as a real process rosette rather
// than a single ink. It reuses the masthead's exact machinery so the two read as one press:
//   * the four `amPlates` lattices (yellow 0°, cyan 15°, magenta 75°, key 45°), one batched path
//     per plate filled once (per-dot fills would double-composite a plate's own overlaps);
//   * the same lighter-on-dark / multiply-on-paper composite;
//   * the AM area law `amRadius` (V-5 — tone->radius lives in ONE place) with amDot's own 0.92
//     no-fuse cap + 0.012 drop floor, so a plate never fuses solid;
//   * the key plate flips white on a dark ground / black on paper, exactly like the masthead key,
//     so a rosette's shadows read on both grounds (pure CMYK cannot print white — the key is the
//     opaque plate that stands in for it).
// The field is NORMALIZED like drawPress ((u,v) in [0,1], `p` the pixel escape hatch); each plate's
// tone is `field * cmyk-component * ink * wash`. Dot centres are offset by (dx,dy)*misreg — the
// misregistration dial. `pr` gates press-in reveal in `th` order (th<1, so the resting frame pr=1
// is unaffected — the golden still pins a fixed frame).
//
// spec: { base, W, H, plates:[{ang,dx,dy,pts}] (amPlates order), field, grain:{ink,wash},
//         misreg=1, paper:'light'|'dark', pr=1 }
const PROCESS_PLATES = [
  { ink: 'yellow', ch: 'y' },
  { ink: 'blue', ch: 'c' },
  { ink: 'pink', ch: 'm' },
  { ink: 'black', ch: 'k' },
];
// Under-color removal. A pure CMYK separation gives a mid/dark colour a heavy black key; on a
// FILLED surface (high tone everywhere) that key stacks under multiply into a dark mesh that
// swallows the CMY colour — the area chart went muddy. A press pulls the key back for exactly this
// reason (GCR/UCR): print less black, let the chromatic plates carry the colour. K_UCR scales the
// key plate's coverage so mid/dark fills stay vivid while the rosette stays genuinely four-plate.
// It never touches the golden — drawProcessAm only runs for CHROMATIC am (max(c,m,y) > 0.02); the
// achromatic/default am surfaces the golden pins press through drawPress, not here.
const K_UCR = 0.55;
// `inks` is the plate palette — defaults to the module INKS, but a caller with a per-context palette
// (createPressContext({ inks })) passes its OWN resolved inks so a themed/custom press keeps instance
// isolation: the process plates print in the same cyan/magenta/yellow/key the rest of that context
// uses, not the module defaults. Only the four process names + white/black key are read.
export function drawProcessAm(ctx, { base, W, H, plates, field, grain = {}, misreg = 1, paper = 'light', pr = 1, inks = INKS }) {
  const ink = grain.ink ?? 1, wash = grain.wash ?? 1;
  const sep = cmyk(base);
  const sample = fieldSampler(field);
  const dark = paper === 'dark';
  // The composite is set for the whole plate stack; the finally GUARANTEES it is restored to
  // source-over even if a field callback throws mid-stack, so a throwing field can never leave the
  // shared canvas stuck in multiply/lighter and corrupt every subsequent draw on it (V7).
  ctx.globalCompositeOperation = dark ? 'lighter' : 'multiply';
  try {
    for (let i = 0; i < plates.length && i < PROCESS_PLATES.length; i++) {
      const pl = plates[i], meta = PROCESS_PLATES[i];
      const comp = meta.ch === 'k' ? sep.k * K_UCR : sep[meta.ch];
      ctx.fillStyle = meta.ch === 'k' ? (dark ? inks.white : inks.black) : inks[meta.ink];
      const dx = pl.dx * misreg, dy = pl.dy * misreg;
      ctx.beginPath();
      for (const p of pl.pts) {
        if (p.th > pr) continue;
        const t = Math.min(0.92, sample(p.x / W, p.y / H, p) * comp * ink * wash);
        if (t <= 0.012) continue;
        const r = amRadius(p.c * 0.56, t);
        if (!(r > 0)) continue;
        ctx.moveTo(p.x + dx + r, p.y + dy);
        ctx.arc(p.x + dx, p.y + dy, r, 0, 6.283);
      }
      ctx.fill();
    }
  } finally {
    ctx.globalCompositeOperation = 'source-over';
  }
}
