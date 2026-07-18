// The type case — every sort (component type) the studio can set, with starter props, plus the
// scene<->code borders: field presets (a Surface field is a closure, so scenes store its NAME and
// resolve it here), scene-JSON sanitizing, and JSX code generation.

import { newId, SCREENS, GEOM, MAX_WORK, frameCost } from './store.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Named Surface fields. `fn` presses in the studio; `src` is emitted verbatim by the code export so
// the copied snippet reproduces the same tone. Keep the two in lockstep.
export const FIELDS = {
  gradient: {
    label: 'Gradient wash',
    fn: (u, v) => clamp01(1 - (u * 0.5 + v * 0.5) + 0.15 * Math.sin(u * 18)),
    src: '(u, v) => Math.max(0, Math.min(1, 1 - (u * 0.5 + v * 0.5) + 0.15 * Math.sin(u * 18)))',
  },
  radial: {
    label: 'Radial bloom',
    fn: (u, v) => clamp01(1.15 - 2.1 * Math.hypot(u - 0.5, v - 0.5)),
    src: '(u, v) => Math.max(0, Math.min(1, 1.15 - 2.1 * Math.hypot(u - 0.5, v - 0.5)))',
  },
  bands: {
    label: 'Ink bands',
    fn: (u, v) => clamp01(0.55 + 0.45 * Math.sin((u * 2 + v) * 9)),
    src: '(u, v) => Math.max(0, Math.min(1, 0.55 + 0.45 * Math.sin((u * 2 + v) * 9)))',
  },
};

// The sample plate for Image frames — an inline SVG so the studio works offline and the scene JSON
// stays portable (no external URL to rot).
const SAMPLE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='150'>"
  + "<linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>"
  + "<stop offset='0' stop-color='black'/><stop offset='1' stop-color='white'/></linearGradient>"
  + "<rect width='240' height='150' fill='url(#g)'/>"
  + "<circle cx='165' cy='62' r='38' fill='black'/></svg>";
export const SAMPLE_IMAGE = 'data:image/svg+xml,' + encodeURIComponent(SAMPLE_SVG);

// One entry per sort. `props` are the starter dials — everything serializable, nothing undefined
// that matters (unset dials inherit the press context's defaults).
export const CASES = [
  { type: 'surface', label: 'Surface', glyph: '▦', w: 260, h: 160,
    props: { fieldName: 'gradient', screen: 'stipple', color: 'fore' } },
  { type: 'text', label: 'Text', glyph: 'A', w: 320, h: 90,
    props: { text: 'HALFTONE', screen: 'stipple', color: 'fore' } },
  { type: 'image', label: 'Image', glyph: '▣', w: 240, h: 150,
    props: { src: SAMPLE_IMAGE, screen: 'stipple', color: 'blue' } },
  { type: 'button', label: 'Button', glyph: '⏺', w: 180, h: 52,
    props: { label: 'Pull a proof', screen: 'stipple', color: 'blue' } },
  { type: 'meter', label: 'Meter', glyph: '▭', w: 220, h: 48,
    props: { value: 0.66, screen: 'stipple', color: 'green' } },
  { type: 'card', label: 'Card', glyph: '❐', w: 260, h: 140,
    props: { heading: 'Plate registration', body: 'Quiet ink under real type.', screen: 'stipple', color: 'fore' } },
  { type: 'barchart', label: 'Bar chart', glyph: '▮', w: 280, h: 170,
    props: { data: [4, 9, 6, 11, 7], screen: 'stipple', color: 'purple' } },
  { type: 'linechart', label: 'Line chart', glyph: '∿', w: 280, h: 170,
    props: { data: [3, 6, 4, 9, 7, 12], area: true, screen: 'stipple', color: 'orange' } },
];
export const CASE_BY_TYPE = Object.fromEntries(CASES.map((c) => [c.type, c]));

export function starterFrame(type, x, y) {
  const c = CASE_BY_TYPE[type];
  if (!c) return null;
  return {
    id: newId(), type, name: c.label,
    x: Math.round(x - c.w / 2), y: Math.round(y - c.h / 2), w: c.w, h: c.h,
    visible: true,
    props: { ...c.props, ...(Array.isArray(c.props.data) ? { data: [...c.props.data] } : null) },
  };
}

// ---- scene import: never trust a file. Rebuild every frame from known keys with fresh ids -------
const num = (v, d) => (Number.isFinite(+v) ? +v : d);
// Geometry ceilings live in the store's GEOM (the reducer clamps EVERY mutation path with them);
// sanitize shares the same constants so import and live edits can never drift apart.
const { MIN_DIM, MAX_DIM, MAX_POS } = GEOM;
// A scene budget on top of the per-frame clamps: per-frame WORK is bounded (core's screen
// budget), but a hostile file multiplies it — hundreds of max-size frames each mount a canvas
// whose backing store alone is ~268MB at dpr 2. Three caps compose, each bounding a different
// resource, all pinned to "two worst frames' worth" — the same order a user reaches with two
// clicks, so multiplication is impossible while any real scene sails through:
//   MAX_FRAMES — React mounts / DOM nodes;
//   MAX_AREA   — canvas backing stores (area IS the right proxy for pixels);
//   MAX_WORK   — point generation, charged through core's own grainCost estimator (shared
//                with the reducer's roll accounting via store.js frameCost), because area is
//                the WRONG proxy for sweep work (quadratic in the diagonal: 64 thin 4096x40
//                hatch frames pass any area cap while costing ~5.6M candidates each).
// Frames past any budget are dropped in order.
const MAX_FRAMES = 64;
const MAX_AREA = 2 * 4096 * 4096;
export function sanitizeScene(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.frames) ? raw.frames : null);
  if (!list) return null;
  const frames = [];
  let area = 0, work = 0;
  for (const f of list) {
    if (frames.length >= MAX_FRAMES) break;
    const c = f && CASE_BY_TYPE[f.type];
    if (!c) continue;
    const p = (f.props && typeof f.props === 'object') ? f.props : {};
    const props = { ...c.props };
    // Free-text props are capped (huge strings feed the text rasterizer / an image decode); a
    // sliced data-URI src just fails to decode -> the Image goes blank, never stale.
    for (const k of ['screen', 'color', 'fieldName', 'text', 'label', 'heading', 'body']) {
      if (typeof p[k] === 'string') props[k] = p[k].slice(0, 500);
    }
    if (typeof p.src === 'string') props.src = p.src.slice(0, 2_000_000);
    // The pitch dials reach the Poisson allocator: grainPts passes r*0.8*scale as the grid pitch
    // and poisson allocates ceil(w/cell)*ceil(h/cell) — a tiny r means a multi-GB grid, r <= 0
    // means Int32Array(Infinity). Clamp every dial to the inspector's own UI range.
    const DIAL_RANGE = { scale: [0.4, 2.4], r: [1, 6], ink: [0.3, 2], value: [0, 1] };
    for (const k of ['scale', 'r', 'ink', 'seed', 'roll', 'value']) {
      if (!Number.isFinite(+p[k])) continue;
      const lim = DIAL_RANGE[k];
      props[k] = lim ? Math.max(lim[0], Math.min(lim[1], +p[k])) : +p[k];
    }
    if (!SCREENS.includes(props.screen)) props.screen = 'stipple';
    if (props.fieldName && !FIELDS[props.fieldName]) props.fieldName = 'gradient';
    if (Array.isArray(p.data)) props.data = p.data.map((n) => num(n, 0)).slice(0, 64);
    if (typeof p.area === 'boolean') props.area = p.area;
    // Bound BOTH ends: a hostile scene with 1e9-px frames would make the press allocate an
    // enormous canvas backing store (tab freeze / null 2d context), and a frame parked at
    // x=1e15 is unreachable. 4096px is far beyond any real workspace frame.
    const w = Math.max(MIN_DIM, Math.min(MAX_DIM, num(f.w, c.w)));
    const h = Math.max(MIN_DIM, Math.min(MAX_DIM, num(f.h, c.h)));
    // Charge the frame at the pitch the press will actually use (spec r*0.8*scale, defaults
    // 2.5/1) — props.r/scale are already clamped to DIAL_RANGE above.
    const cost = frameCost({ w, h, props });
    if (area + w * h > MAX_AREA || work + cost > MAX_WORK) break;
    area += w * h;
    work += cost;
    frames.push({
      id: newId(), type: f.type,
      name: typeof f.name === 'string' && f.name.trim() ? f.name.slice(0, 80) : c.label,
      x: Math.max(-MAX_POS, Math.min(MAX_POS, num(f.x, 0))),
      y: Math.max(-MAX_POS, Math.min(MAX_POS, num(f.y, 0))),
      w, h,
      visible: f.visible !== false,
      props,
    });
  }
  return frames;
}

// ---- code export: the studio's props back out as JSX --------------------------------------------
const COMPONENT = {
  surface: 'Surface', text: 'Text', image: 'Image', button: 'Button',
  meter: 'Meter', card: 'Card', barchart: 'BarChart', linechart: 'LineChart',
};
const DIALS = ['screen', 'scale', 'r', 'ink', 'seed', 'roll', 'color'];

// User-controlled text (labels, headings, imported scene strings) must never reach the snippet raw:
// JSX attribute strings have NO backslash escapes (a lone `"` is unrecoverable) and raw children
// parse `{`/`<` as syntax — hostile imported text could even smuggle live JSX. Emit the plain form
// only for a conservative allowlist; everything else rides inside a {JSON.stringify(...)} expression
// container, where JS string semantics make any content inert.
const PLAIN_ATTR = /^[A-Za-z0-9 _.,:;!?#()%+@'\/-]*$/;
const PLAIN_TEXT = /^[A-Za-z0-9 _.,:;!?#()%+@'\/-]*$/;
const attr = (k, v) => {
  if (typeof v !== 'string') return `${k}={${JSON.stringify(v)}}`;
  return PLAIN_ATTR.test(v) ? `${k}="${v}"` : `${k}={${JSON.stringify(v)}}`;
};
const child = (v) => {
  const s = String(v ?? '');
  return PLAIN_TEXT.test(s) ? s : `{${JSON.stringify(s)}}`;
};

function frameJSX(f) {
  const p = f.props;
  const parts = [];
  // fieldName is an identifier spliced into code — only registry names may pass (import already
  // clamps this, but the exporter must hold on its own since props are live-editable).
  if (f.type === 'surface') parts.push(`field={${FIELDS[p.fieldName] ? p.fieldName : 'gradient'}}`);
  if (f.type === 'text') parts.push(attr('text', p.text ?? ''));
  if (f.type === 'image') parts.push(attr('src', p.src ?? ''));
  if (f.type === 'meter') parts.push(`value={${JSON.stringify(p.value ?? 0)}}`);
  if (f.type === 'barchart' || f.type === 'linechart') {
    const nums = (p.data || []).map((n) => (Number.isFinite(+n) ? +n : 0));
    parts.push(`data={[${nums.join(', ')}]}`, attr('caption', f.name));
    if (f.type === 'linechart' && p.area) parts.push('area');
  }
  for (const k of DIALS) if (p[k] != null) parts.push(attr(k, p[k]));
  if (f.type !== 'text' && f.type !== 'button' && f.type !== 'card') parts.push(`h={${f.h}}`);
  const open = `<${COMPONENT[f.type]} ${parts.join(' ')}`;
  if (f.type === 'button') return `${open}>${child(p.label)}</Button>`;
  if (f.type === 'card') return `${open}>\n    <h3>${child(p.heading)}</h3>\n    <p>${child(p.body)}</p>\n  </Card>`;
  return `${open} />`;
}

export function sceneJSX(frames) {
  const used = [...new Set(frames.map((f) => COMPONENT[f.type]))];
  const fieldNames = [...new Set(frames.filter((f) => f.type === 'surface')
    .map((f) => (FIELDS[f.props.fieldName] ? f.props.fieldName : 'gradient')))];
  const lines = [
    `import { HalftoneProvider${used.length ? ', ' + used.join(', ') : ''} } from './halftone-kit/react/index.js';`,
    '',
  ];
  for (const n of fieldNames) lines.push(`const ${n} = ${FIELDS[n].src};`);
  if (fieldNames.length) lines.push('');
  lines.push('<HalftoneProvider mode="dark">');
  for (const f of frames) lines.push(`  ${frameJSX(f)}`);
  lines.push('</HalftoneProvider>');
  return lines.join('\n');
}
