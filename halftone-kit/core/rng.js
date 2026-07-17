// Deterministic randomness and value-noise. Pure math — no browser globals, so the module
// is safe to import under SSR (V-3). Every point-generator and field draws its jitter from a
// mulberry32 seeded per surface, which is what makes a press reproducible under a fixed seed.

// mulberry32: a fast seedable PRNG. `seed` in, a () => [0,1) generator out. Arithmetic is
// identical to the docs engine — the golden frame depends on this exact sequence.
export const mulberry32 = (s) => () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Bridson Poisson-disk sampling: blue-noise points no closer than r apart. This is the
// `stipple` screen's point set. `th` (a per-point threshold in [0,1)) is drawn here so the
// press can reveal points in a stable pseudo-random order.
export function poisson(w, h, r, rng) {
  const cell = r / Math.SQRT2, gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [], active = [];
  const put = (x, y) => {
    const p = { x, y, th: rng() };
    grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] = pts.length;
    pts.push(p); active.push(p);
  };
  put(rng() * w, rng() * h);
  while (active.length) {
    const idx = (rng() * active.length) | 0, base = active[idx];
    let placed = false;
    for (let n = 0; n < 24; n++) {
      const a = rng() * 6.283, d = r * (1 + rng());
      const x = base.x + Math.cos(a) * d, y = base.y + Math.sin(a) * d;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      let ok = true;
      for (let yy = Math.max(0, gy - 2); ok && yy <= Math.min(gh - 1, gy + 2); yy++)
        for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
          const q = grid[yy * gw + xx];
          if (q >= 0) {
            const dx = pts[q].x - x, dy = pts[q].y - y;
            if (dx * dx + dy * dy < r * r) { ok = false; break; }
          }
        }
      if (ok) { put(x, y); placed = true; break; }
    }
    if (!placed) active.splice(idx, 1);
  }
  return pts;
}

// Two-octave value noise, seeded. Used for the drifting `wash`/gradient fields. Returns a
// sampler (x, y) => [0,1]. Seed is a number, not a generator, so the field is position-pure.
export function makeNoise(seed) {
  const h = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 0.618) * 43758.5453;
    return s - Math.floor(s);
  };
  const sm = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return h(ix, iy) * (1 - ux) * (1 - uy) + h(ix + 1, iy) * ux * (1 - uy) +
           h(ix, iy + 1) * (1 - ux) * uy + h(ix + 1, iy + 1) * ux * uy;
  };
  return (x, y) => 0.66 * sm(x, y) + 0.34 * sm(x * 2.1 + 40, y * 2.1 + 40);
}
