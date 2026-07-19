// Ink and paper palettes plus the press-harmony pass. Pure color math — no browser globals.
// The named INKS are the default plate colors; a context can override them. `tuneInk`/`tuneMix`
// are the harmony pass that pulls two inks into one lightness/chroma band so neither plate
// dominates — this must run at draw time on resolved colors (see the lazy-color rule, V-11).

export const INKS = {
  blue: '#3D5FB8', orange: '#D07030', purple: '#7A66E0', pink: '#C24E9C', yellow: '#D9A833',
  red: '#C24538', green: '#3F8A5C', black: '#23252C', white: '#F2EFE6',
};
export const PAPER = { light: '#EDE9DE', dark: '#141519' };

// Multiplicative hex mix — the base overprint of two inks before harmony softens it.
export const mixHex = (a, b) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sa, sb) => Math.round((sa * sb) / 255);
  return '#' + ((1 << 24) + (ch(pa >> 16, pb >> 16) << 16) +
    (ch((pa >> 8) & 255, (pb >> 8) & 255) << 8) + ch(pa & 255, pb & 255)).toString(16).slice(1);
};

// Smoothstep band — maps a value across [lo,hi] with ease. Used to turn field darkness into
// per-screen ink weights.
export const iband = (d, lo, hi) => {
  const t = Math.max(0, Math.min(1, (d - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb2hex = (r, g, b) => '#' + [r, g, b].map((v) =>
  Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const rgb2hsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
};
const hue2c = (p, q, t) => {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
};
const hsl2hex = (h, s, l) => {
  if (s === 0) return rgb2hex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return rgb2hex(hue2c(p, q, h + 1 / 3) * 255, hue2c(p, q, h) * 255, hue2c(p, q, h - 1 / 3) * 255);
};
const band = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Pull an ink into one lightness/chroma band so neither plate dominates the press. The black key
// and white base (low chroma) stay put.
export const tuneInk = (hex) => {
  const [h, s, l] = rgb2hsl(...hex2rgb(hex));
  if (s < 0.18) return hex;
  return hsl2hex(h, band(s, 0.44, 0.62), band(l, 0.42, 0.52));
};

// Soften the multiply on the mix plate — a pure multiply of two saturated inks crushes to mud;
// lift it into a rich overprint instead.
export const tuneMix = (a, b) => {
  const [h, s, l] = rgb2hsl(...hex2rgb(mixHex(a, b)));
  return hsl2hex(h, band(s, 0.30, 0.55), band(l, 0.26, 0.38));
};

// Parse a resolved CSS colour to sRGB 0..255. The docs/INKS emit 6-digit hex, but the adapter's
// public `color` prop and its palette (filled from CSS custom props) can hand cmyk a 3-digit hex or
// an `rgb()`/`rgba()` string — resolveColor (press.js) passes ANY CSS colour straight through. This
// reads those three shapes and returns null for anything else (named colours, hsl(), modern syntax,
// malformed input) so cmyk can fall back DETERMINISTICALLY instead of producing NaN plates. Space-
// or comma-separated rgb() both parse; the alpha of rgba() is ignored (the press has no plate alpha).
const parseSrgb = (s) => {
  if (typeof s !== 'string') return null;
  const h = s.trim();
  const hm = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
  if (hm) {
    const x = hm[1];
    if (x.length === 3) return [x[0] + x[0], x[1] + x[1], x[2] + x[2]].map((p) => parseInt(p, 16));
    return [x.slice(0, 2), x.slice(2, 4), x.slice(4, 6)].map((p) => parseInt(p, 16));
  }
  // rgb()/rgba() in EITHER legacy comma syntax `rgb(r, g, b[, a])` OR modern space syntax
  // `rgb(r g b[ / a])` — never a mix of the two. A comma/space blend like `rgb(255, 0 0)` is invalid
  // CSS the canvas itself would reject, so it takes the deterministic fallback rather than the
  // chromatic four-plate path (where the separation would disagree with how the canvas paints the
  // fill). Each channel is an anchored number token (`\d+(?:\.\d+)?` — one+ digit, at most one dot, so
  // `.`, `1.2.3`, bare junk are rejected, never coerced to NaN); the optional alpha is ignored; and
  // the string must END at the close paren (no trailing garbage). Anchoring guarantees finite
  // channels — the explicit finite check is a belt in case the grammar is ever loosened.
  const rgbComma = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*\d+(?:\.\d+)?%?\s*)?\)\s*$/i;
  const rgbSpace = /^rgba?\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*(?:\/\s*\d+(?:\.\d+)?%?\s*)?\)\s*$/i;
  const rm = rgbComma.exec(h) || rgbSpace.exec(h);
  if (rm) {
    const ch = [+rm[1], +rm[2], +rm[3]];
    if (!ch.every(Number.isFinite)) return null;
    return ch.map((v) => Math.max(0, Math.min(255, v)));
  }
  return null;
};

// CMYK separation from a resolved sRGB colour — the process ink amounts (0..1). The four-plate AM
// press (drawProcessAm) uses this to render ANY fill as a real process rosette: c->cyan(blue),
// m->magenta(pink), y->yellow, k->black key. Standard GCR-free separation: k is how far the
// brightest channel is from white; the CMY amounts are what's left after the key is pulled out. A
// fully achromatic colour (max(c,m,y) ~ 0) has no process content — the caller prints it as a single
// plate instead. An UNPARSEABLE colour (named/hsl/malformed) returns the same all-zero-chroma result,
// so the chromatic guard routes it to the single-plate path rather than NaN plates — a colour the
// separator can't read still presses, just as one ink.
export const cmyk = (hex) => {
  const rgb = parseSrgb(hex);
  if (!rgb) return { c: 0, m: 0, y: 0, k: 0 };
  const [r, g, b] = rgb.map((v) => v / 255);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  return { c: (1 - r - k) / (1 - k), m: (1 - g - k) / (1 - k), y: (1 - b - k) / (1 - k), k };
};
