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
// The dispatch, point by point (single-plate / mono press):
//   press-in gate : a point inks only once the run has reached its threshold (p.th <= pr)
//   am (p.c)      : amplitude — the cell carries tone, sqrt radius, no threshold (amDot)
//   stipple       : a round dot, radius 0.42 + 0.85*min(1.15, v)
//   line family   : a square dot, side 1.05 + 0.75*min(1.15, v)  (hatch/lines/waves)
// Every non-am screen thresholds the near-fixed dot against the point's own value (v > p.th) —
// that FM threshold is what makes a line screen a line screen.

import { amDot } from './screens.js';

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
//   plates : optional multi-plate stack (masthead / depth-stacked charts) — see the P2 seam below
//   grain  : { ink } render dials; drawPress applies grain.ink to the field value
//   pr     : press-in progress 0..1 (the entrance transient; 1 = fully pressed / resting frame)
//   roll   : resting-geometry entropy — consumed at point generation (mount/rebuild), accepted
//            here for signature stability across the 4->1 collapse (§4a); the draw loop is
//            seed/roll-invariant given its pts.
export function drawPress(ctx, { pts, W, H, field, plates = null, screen, grain = {}, pr = 1, roll = 0 }) {
  const ink = grain.ink ?? 1;

  if (plates && plates.length) {
    // P2 SEAM. The masthead batches all arcs into ONE path per plate and fills once under a
    // multiply/lighter composite (docs:4907-4951); that batched+composited draw is NOT pixel-
    // equivalent to per-dot fills (overlaps double-composite), and its field sampling offsets the
    // wordmark per plate at a pitch-derived radius — a contract that only the golden can pin down.
    // So the plate BODY is authored in P2 wired + byte-verified, never guessed blind. The signature
    // and this one call site are what land in P1; P2 replaces this throw with the verified loop.
    throw new Error('drawPress: multi-plate rendering lands in P2 (golden-gated); see plans/halftone-kit-extraction.md §4a/§5');
  }

  const sample = fieldSampler(field);
  const round = !screen || screen === 'stipple';
  for (const p of pts) {
    if (p.th > pr) continue;
    const v = sample(p.x / W, p.y / H) * ink;
    if (p.c) { amDot(ctx, p, v); continue; }
    if (v > p.th) {
      if (round) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 0.42 + 0.85 * Math.min(1.15, v), 0, 6.283); ctx.fill();
      } else {
        const d = 1.05 + 0.75 * Math.min(1.15, v);
        ctx.fillRect(p.x - d / 2, p.y - d / 2, d, d);
      }
    }
  }
}
