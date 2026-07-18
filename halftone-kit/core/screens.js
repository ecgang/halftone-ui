// The screens: how a tone is broken into dots. Every generator returns a point set the press
// then inks. All but `am` are FM (frequency-modulated) — a near-fixed dot thresholded against
// the point's own value `th`; `am` (amplitude modulation) instead carries a cell size `c` and
// modulates dot AREA with no threshold, which is what makes it print an image rather than lay a
// texture over a shape. Pure geometry; arithmetic identical to the docs engine (V-4).

import { poisson } from './rng.js';

// Points along a rotated line screen. `waves` adds a per-row phase-shifted sine so the lines
// undulate. `j` is a per-point jitter in [0,1) the caller maps into a threshold band.
export function screenPts(W, H, pitch, angle, rng, wave) {
  const pts = [], ca = Math.cos(angle), sa = Math.sin(angle);
  const R = Math.hypot(W, H) / 2 + pitch, cx = W / 2, cy = H / 2;
  const step = Math.max(1.6, pitch * 0.26);
  for (let v = -R; v <= R; v += pitch) {
    const ph = rng() * 6.283;
    for (let u = -R; u <= R; u += step) {
      const vv = v + (wave ? pitch * 0.85 * Math.sin(u / (pitch * 2.6) + ph) : 0);
      const x = cx + u * ca - vv * sa, y = cy + u * sa + vv * ca;
      if (x < -2 || y < -2 || x > W + 2 || y > H + 2) continue;
      pts.push({ x, y, j: rng() });
    }
  }
  return pts;
}

// Amplitude-modulation grid: a square lattice at `ang` (the classic 45° key-plate angle for the
// K plate). Coarser than the line families because a dot must grow from nothing to full coverage
// inside its own cell. Every point carries its cell size in `c` — that flag is what tells the
// press to modulate area. `th` here is press-in reveal ORDER only; am has no tone threshold.
export function amPts(W, H, pitch, ang, rng) {
  const pts = [], R = Math.hypot(W, H) / 2 + pitch;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let u = -R; u < R; u += pitch)
    for (let v = -R; v < R; v += pitch) {
      const x = W / 2 + u * ca - v * sa, y = H / 2 + u * sa + v * ca;
      if (x < -pitch || y < -pitch || x > W + pitch || y > H + pitch) continue;
      pts.push({ x, y, c: pitch, th: rng() });
    }
  return pts;
}

// The screen selector. A surface presses as stipple, lines, waves, hatch or am. `hatch` is three
// line families at different angles/bands; `lines`/`waves` are a single family. `am` delegates to
// the square grid. `pat` falsy or 'stipple' -> blue noise.
// Poisson's grid allocation is ceil(W/cell)*ceil(H/cell) Int32 entries with cell = r/SQRT2 —
// cost couples AREA to PITCH, so independently-legal extremes (a 4096px frame at the minimum
// pitch dial) compound into a multi-GB grid no single-value clamp can see. Floor the pitch so
// the grid never exceeds MAX_CELLS (~8.4MB): r >= sqrt(2*W*H/MAX_CELLS). The line/am families
// don't need this — they already carry absolute pitch floors (2.8 / 4.4) and no grid.
const MAX_CELLS = 2097152;

export function grainPts(W, H, r, rng, pat) {
  if (!pat || pat === 'stipple') {
    // Non-finite or <=0 r would make poisson's grid indices NaN — every neighbor check misses,
    // every candidate places, and the active list never drains (an infinite loop, not a throw).
    if (!(Number.isFinite(r) && r > 0)) r = 2;
    return poisson(W, H, Math.max(r, Math.sqrt((2 * W * H) / MAX_CELLS)), rng);
  }
  if (pat === 'am') return amPts(W, H, Math.max(4.4, r * 3.4), 0.785, rng);
  const pts = [], pitch = Math.max(2.8, r * 2.2);
  const fams = pat === 'hatch'
    ? [[0.26, 0.04, 0.42], [1.83, 0.34, 0.72], [1.05, 0.62, 1.0]]
    : [[pat === 'waves' ? 0 : -0.62, 0.05, 1.0]];
  for (const [a, lo, hi] of fams)
    for (const q of screenPts(W, H, pitch, a, rng, pat === 'waves'))
      pts.push({ x: q.x, y: q.y, th: lo + q.j * (hi - lo) });
  return pts;
}

// The AM area-law radius — the ONE place tone becomes a dot size for the amplitude family (V-5,
// AM half). Tone drives AREA, so radius goes as sqrt(tone); `base` sets full-coverage size and
// `wobble` is an optional per-dot size jitter (1 = none). Three surfaces reduce to this call and
// nothing else: amDot (`base = p.c*0.56`), the masthead plate (`base = cell*0.56`, tone already
// swept), and the Studio ink surface (`base = rmax`, `wobble = 0.82 + 0.36*j`). It is the AM
// sibling of drawPress's FM law `base + span*min(cap, v)`: FM thresholds a fixed dot, AM grows one.
export function amRadius(base, tone, wobble = 1) {
  return base * Math.sqrt(tone) * wobble;
}

// The am dot: an amplitude mark at cell size `p.c`. The 0.92 cap sits below 1 because dots reach
// full coverage at r = cell/sqrt(2) — a plate that fuses solid stops being a halftone. The 0.012
// floor drops dots too faint to matter. Takes an already-styled 2D context (fillStyle set by the
// caller). This is one of the two primitive marks the presses are built from; its radius is
// `amRadius` so the AM law lives in exactly one place.
export function amDot(ctx, p, v) {
  const t = Math.min(0.92, v);
  if (t <= 0.012) return;
  ctx.beginPath(); ctx.arc(p.x, p.y, amRadius(p.c * 0.56, t), 0, 6.283); ctx.fill();
}
