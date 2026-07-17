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
