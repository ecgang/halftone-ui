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
