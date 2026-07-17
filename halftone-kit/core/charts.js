// Chart geometry as tone fields — the SAME field(u,v)->darkness contract Text and Image use, so a
// chart is "just another surface": drawPress asks how dark the ink is at (u,v) and the screen turns
// that into stipple/line/hatch/am. Pure + DOM-free (V-8) + SSR-safe (V-3): each builder closes over
// data + layout numbers and returns a sampler; nothing here touches a canvas. Coordinates follow
// draw.js:64 — u = 0 left .. 1 right, v = 0 TOP .. 1 bottom — so every mark is anchored to the
// baseline v = 1 and grows upward.
//
// The adapter's <BarChart>/<LineChart> wrap these; a Vue adapter (P4) reuses them unchanged. They
// are imported DIRECTLY (not via core/index.js) so they never enter the docs standalone bundle.

// Normalize a value list to [0,1] heights against a shared max (bars and lines share one y-scale —
// the dataviz "one axis" rule). A non-positive or absent max falls back to the data max (else 1).
function heights(values, max) {
  const m = max != null ? max : Math.max(0, ...values);
  const d = m > 0 ? m : 1;
  return values.map((x) => Math.max(0, Math.min(1, (x || 0) / d)));
}

// Interpolate a height at u across n samples pinned to the slot CENTERS ((i+0.5)/n), so line points
// sit exactly over bar centers and the end points are not clipped to the surface edge. Flat past the
// first/last center.
function lineY(h, n) {
  if (n === 1) return () => h[0];
  const c0 = 0.5 / n, c1 = 1 - 0.5 / n;
  return (u) => {
    if (u <= c0) return h[0];
    if (u >= c1) return h[n - 1];
    const x = ((u - c0) / (c1 - c0)) * (n - 1); // map [c0,c1] -> [0, n-1]
    const i = Math.floor(x), t = x - i;
    return h[i] + (h[i + 1] - h[i]) * t;
  };
}

// barsField — vertical bars, one per value, baseline-anchored. `gap` is the fraction of each column
// slot left blank between bars (0..0.9). Solid ink inside a bar; the screen supplies the texture.
export function barsField(values = [], opts = {}) {
  const n = values.length;
  if (!n) return () => 0;
  const h = heights(values, opts.max);
  const gap = Math.max(0, Math.min(0.9, opts.gap ?? 0.28));
  return (u, v) => {
    if (u < 0 || u >= 1) return 0;
    let i = Math.floor(u * n);
    if (i >= n) i = n - 1;
    const f = u * n - i;                       // position within the column slot [0,1)
    if (f < gap / 2 || f > 1 - gap / 2) return 0; // inter-bar gutter
    return v >= 1 - h[i] ? 1 : 0;              // baseline-anchored fill
  };
}

// areaField — the filled region under the polyline through the values, baseline-anchored.
export function areaField(values = [], opts = {}) {
  const n = values.length;
  if (!n) return () => 0;
  const yAt = lineY(heights(values, opts.max), n);
  return (u, v) => (v >= 1 - yAt(u) ? 1 : 0);
}

// lineField — a stroked polyline. `stroke` is the half-thickness in NORMALIZED v units (a vertical
// band, soft-edged so a screen feathers it cleanly against the FM threshold). Steep segments read
// slightly thicker — fine for sparklines; a perpendicular SDF is a later refinement.
export function lineField(values = [], opts = {}) {
  const n = values.length;
  if (!n) return () => 0;
  const stroke = opts.stroke ?? 0.06;
  const yAt = lineY(heights(values, opts.max), n);
  return (u, v) => {
    const dist = Math.abs(v - (1 - yAt(u)));   // distance to the line's down-position at u
    if (dist > stroke) return 0;
    return 1 - 0.5 * (dist / stroke);          // 1 at the center, 0.5 at the edge
  };
}
