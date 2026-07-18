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
// One shared work budget for every screen family: poisson grid cells for stipple, sweep
// candidates per family for the line/am lattices. Cost couples SIZE to PITCH, so
// independently-legal extremes (a 4096px frame at the minimum pitch dial) compound into
// multi-GB allocations or millions of retained point objects that no single-value clamp can
// see. Two subtleties the budget must respect: (1) stipple's bound is the EXACT
// ceil(W/cell)*ceil(H/cell) product, not the area approximation — on a thin canvas
// (W=4096, H=0.001) ceiling overhead dominates and an area-derived floor still allocates
// millions of columns; (2) the line/am absolute pitch floors (2.8 / 4.4) bound DENSITY but
// not TOTAL work, which is quadratic in the frame diagonal — a 4096px hatch at floor pitch
// is ~7.5M candidates per family, x3 families.
const MAX_CELLS = 2097152;

// Budget helpers shared by grainPts (the generator) and grainCost (the estimator). ONE
// implementation, so an admission decision made from grainCost can never drift from the work
// grainPts actually executes. Each doubles its pitch/cell until the work fits MAX_CELLS;
// doubling terminates in O(log) steps for finite dims and overshoots at most 2x. The sweep
// count converges to a small constant as pitch grows, so the line/am loops always terminate.
const stippleCell = (W, H, r) => {
  let cell = r / Math.SQRT2;
  while (Math.ceil(W / cell) * Math.ceil(H / cell) > MAX_CELLS) cell *= 2;
  return cell;
};
// Both lattices iterate ~(2R/pitch) rows x (2R/step) columns per family with
// R = hypot(W,H)/2 + pitch (so 2R = diag + 2*pitch).
const lineIter = (diag, p) => ((diag + 2 * p) / p) * ((diag + 2 * p) / Math.max(1.6, p * 0.26));
const linePitch = (diag, r) => {
  let p = Math.max(2.8, r * 2.2);
  while (lineIter(diag, p) > MAX_CELLS) p *= 2;
  return p;
};
const amIter = (diag, p) => ((diag + 2 * p) / p) ** 2;
const amPitch = (diag, r) => {
  let p = Math.max(4.4, r * 3.4);
  while (amIter(diag, p) > MAX_CELLS) p *= 2;
  return p;
};

export function grainPts(W, H, r, rng, pat) {
  // Degenerate dimensions: nothing drawable — guarded BEFORE pattern dispatch, because every
  // family fails differently: Infinity spins the stipple budget loop AND the line/am sweep
  // loops (-Infinity + pitch never advances), mixed-sign gw*gh makes Int32Array throw.
  if (!(Number.isFinite(W) && Number.isFinite(H) && W > 0 && H > 0)) return [];
  // Non-finite or <=0 r would make poisson's grid indices NaN — every neighbor check misses,
  // every candidate places, and the active list never drains (an infinite loop, not a throw).
  // On the lattice families it would NaN the pitch and press empty; defaulting is uniform.
  if (!(Number.isFinite(r) && r > 0)) r = 2;
  if (!pat || pat === 'stipple') return poisson(W, H, stippleCell(W, H, r) * Math.SQRT2, rng);
  const diag = Math.hypot(W, H);
  if (pat === 'am') return amPts(W, H, amPitch(diag, r), 0.785, rng);
  const pitch = linePitch(diag, r);
  const pts = [];
  const fams = pat === 'hatch'
    ? [[0.26, 0.04, 0.42], [1.83, 0.34, 0.72], [1.05, 0.62, 1.0]]
    : [[pat === 'waves' ? 0 : -0.62, 0.05, 1.0]];
  for (const [a, lo, hi] of fams)
    for (const q of screenPts(W, H, pitch, a, rng, pat === 'waves'))
      pts.push({ x: q.x, y: q.y, th: lo + q.j * (hi - lo) });
  return pts;
}

// Admission-control estimator: the work grainPts would execute for these arguments, in the
// units the internal budget clamps (grid cells / sweep candidates, x3 for hatch's families).
// The per-CALL budget above bounds one frame; a host mounting MANY frames (the studio's scene
// import) must bound the AGGREGATE, and area is the wrong proxy — sweep work is quadratic in
// the DIAGONAL, so 64 thin 4096x40 hatch frames pass any area cap while costing ~5.6M
// candidates each. Charging admissions through this estimator keeps the host's math exact.
export function grainCost(W, H, r, pat) {
  if (!(Number.isFinite(W) && Number.isFinite(H) && W > 0 && H > 0)) return 0;
  if (!(Number.isFinite(r) && r > 0)) r = 2;
  if (!pat || pat === 'stipple') {
    const cell = stippleCell(W, H, r);
    return Math.ceil(W / cell) * Math.ceil(H / cell);
  }
  const diag = Math.hypot(W, H);
  if (pat === 'am') return amIter(diag, amPitch(diag, r));
  return (pat === 'hatch' ? 3 : 1) * lineIter(diag, linePitch(diag, r));
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
