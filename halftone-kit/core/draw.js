// drawPress — the single press. One point set + one field value + one screen -> inked dots.
// This is the tone->radius site the whole engine funnels through (V-5). It reproduces the docs
// engine's generic surface draw (docs/index.html:3140-3165) exactly, so the golden frame stays
// byte-identical when a surface is rebuilt on the core.
//
// The dispatch, point by point:
//   press-in gate : a point inks only once the run has reached its threshold (p.th <= pr)
//   am (p.c)      : amplitude — area carries tone, sqrt radius, no threshold (amDot)
//   stipple       : a round dot, radius 0.42 + 0.85*min(1.15, v)
//   line family   : a square dot, side 1.05 + 0.75*min(1.15, v)  (hatch/lines/waves)
// Every non-am screen thresholds the near-fixed dot against the point's own value (v > p.th) —
// that FM threshold is what makes a line screen a line screen.
//
// SCOPE: this is the single-plate press. The masthead (four CMYK plates batched into one path
// per plate under a multiply/lighter composite) and the depth-stacked chart plates fold onto
// this primitive during P2, where the golden verifies each is byte-identical — their batched +
// composited draw is not pixel-equivalent to per-dot fills, so it is proven wired, not guessed.

import { amDot } from './screens.js';

// value(p) -> the point's field darkness in [0,1] BEFORE the ink dial (drawPress applies ink).
// The caller closes value over its field/geometry (text sample, luminance, chart height, noise,
// animation state) — keeping drawPress the one place tone becomes a mark.
export function drawPress(ctx, { pts, value, screen, pr = 1, ink = 1 }) {
  const round = !screen || screen === 'stipple';
  for (const p of pts) {
    if (p.th > pr) continue;
    const v = value(p) * ink;
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
