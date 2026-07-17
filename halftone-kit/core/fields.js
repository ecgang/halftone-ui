// A field is the tone contract: field(u, v) -> darkness in [0,1] over normalized coords. Text,
// photo luminance, chart geometry and SDF marks are all fields internally; the press only ever
// asks "how dark is the ink here?". This module builds the fields that need help constructing.
//
// The core never touches the DOM itself (V-8) and must import clean under SSR (V-3), so anything
// that needs an offscreen canvas takes a `createCanvas` factory from the caller (the adapter
// passes `() => document.createElement('canvas')`).

// Rasterise a wordmark once, then read it back as a tone field. `createCanvas` yields a canvas
// element; the returned `sample(x, y, r)` averages a 3x3 grid over the cell so a screen resolves
// letterform edges into partial dots instead of stair-stepping them. Coordinates are in pixels
// over the returned height H — a caller normalizing to [0,1] scales by W and H. Arithmetic is
// identical to the docs engine's textField (V-4).
export function textField(text, W, createCanvas) {
  const o = createCanvas();
  const c = o.getContext('2d', { willReadFrequently: true });
  const setFont = (px) => {
    c.font = `900 ${px}px "Helvetica Neue", "Arial Black", Inter, system-ui, sans-serif`;
    try { c.letterSpacing = `${-px * 0.035}px`; } catch (e) {}
  };
  // width scales linearly with size (tracking is proportional), so one measure fits it
  setFont(400);
  const size = Math.max(24, Math.floor(400 * (W * 0.94) / c.measureText(text).width));
  setFont(size);
  const m = c.measureText(text);
  const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
  const H = Math.round((asc + desc) * 1.34);
  o.width = W; o.height = H;
  setFont(size); // sizing a canvas resets every ctx property, including the font
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#fff';
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillText(text, W / 2, (H + asc - desc) / 2);
  const d = c.getImageData(0, 0, W, H).data;
  const at = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    return d[(((y | 0) * W) + (x | 0)) * 4] / 255;
  };
  // Average over the cell rather than point-sample it. A real screen resolves an edge into
  // partial dots; a point sample would stair-step the letterforms.
  const sample = (x, y, r) => {
    let s = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += at(x + i * r * 0.66, y + j * r * 0.66);
    return s / 9;
  };
  return { H, sample };
}
