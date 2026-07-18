// P4 verification harness for @halftone-ui/vue. Mirrors tools/verify-react.mjs one-for-one: the
// core's RENDERING is already golden-verified; this proves the ADAPTER's contract, which the golden
// can't see — mount binds to the caller's element, prop changes push through set(), unmount calls
// destroy() (registry back to baseline — blocker 1, the leak), and the module is SSR-safe. Vue needs
// no JSX/SFC compile (the adapter is plain defineComponent + h()), so the only reason to esbuild at
// all is that the adapter imports the bare specifier 'vue' from outside tools/ — bundling with 'vue'
// marked external and writing the bundle INTO tools/ lets Node resolve it against tools/node_modules,
// the same instance our own top-level `import ... from 'vue'` below resolves to (one singleton).
//
// Run: node tools/verify-vue.mjs   (from repo root or tools/)

import esbuild from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
// NOTE: 'vue' and '@vue/server-renderer' are imported dynamically, further down, AFTER the jsdom
// globals are installed. @vue/runtime-dom's nodeOps module captures `document` into a module-scope
// const at IMPORT time (not at mount time) — a static top-level `import ... from 'vue'` here would
// load runtime-dom before jsdom exists and permanently freeze that capture at `null`, breaking every
// live mount below. A dynamic import() is a runtime call, so ordering it after the jsdom setup gives
// runtime-dom a live `document` to capture.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const vueIndex = path.join(ROOT, 'halftone-kit', 'vue', 'index.js');
const coreIndex = path.join(ROOT, 'halftone-kit', 'core', 'index.js');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

// ---- 1. Bundle the adapter with vue left external ------------------------------------------------
const entry = `
  import { HalftoneProvider, useHalftoneContext, usePress, Surface, Text, Image, Button, Meter, Card, BarChart, LineChart } from ${JSON.stringify(vueIndex)};
  import { createPressContext } from ${JSON.stringify(coreIndex)};
  export { HalftoneProvider, useHalftoneContext, usePress, Surface, Text, Image, Button, Meter, Card, BarChart, LineChart, createPressContext };
`;
const built = await esbuild.build({
  absWorkingDir: ROOT,
  stdin: { contents: entry, resolveDir: HERE, loader: 'js', sourcefile: 'verify-vue-entry.js' },
  bundle: true, format: 'esm', target: 'es2020', charset: 'utf8',
  external: ['vue'],
  write: false,
});
ok('adapter bundles (no unresolved imports)', built.outputFiles.length === 1);
const tmp = path.join(HERE, '.verify-vue.bundle.mjs');   // in tools/ so `vue` resolves
fs.writeFileSync(tmp, built.outputFiles[0].text);

// ---- 2. jsdom + a stubbed 2D context (no native canvas package) ----------------------------------
// This must happen BEFORE 'vue' is ever imported: @vue/runtime-dom's nodeOps module captures
// `document` into a module-scope const at IMPORT time, not at mount time, so importing vue first
// would freeze that capture at `undefined` and break every live mount below.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
const drawnPerCanvas = new WeakMap();
const HC = window.HTMLCanvasElement;
HC.prototype.getContext = function () {
  let calls = drawnPerCanvas.get(this);
  if (!calls) { calls = []; drawnPerCanvas.set(this, calls); }
  const target = {
    canvas: this,
    measureText: () => ({ width: 100, actualBoundingBoxAscent: 80, actualBoundingBoxDescent: 20 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)) }),
  };
  return new Proxy(target, {
    get(t, k) { return k in t ? t[k] : (() => { calls.push(String(k)); }); },
    set(t, k, v) { if (k === 'fillStyle') calls.push('fillStyle=' + v); return true; },
  });
};
Object.defineProperty(HC.prototype, 'clientWidth', { configurable: true, get() { return 300; } });
Object.defineProperty(HC.prototype, 'clientHeight', { configurable: true, get() { return 150; } });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
// jsdom's Image never fires load (no decode). Stub one that records instances so the test can fire
// onload/onerror deterministically (an auto-firing timer would race Vue's reactivity flush).
const madeImages = [];
window.Image = class FakeImage { constructor() { this.width = 200; this.height = 120; this.onload = null; this.onerror = null; this.crossOrigin = null; madeImages.push(this); } set src(v) { this._src = v; } get src() { return this._src; } };
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.devicePixelRatio = 1;

// publish jsdom globals the way @vue/runtime-dom expects (it reads bare `document`, etc.)
globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.HTMLCanvasElement = HC;
globalThis.SVGElement = window.SVGElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Text = window.Text;
globalThis.Comment = window.Comment;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.CustomEvent = window.CustomEvent;
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
globalThis.devicePixelRatio = 1;

const clearsOf = (canvas) => (drawnPerCanvas.get(canvas) || []).filter((c) => c === 'clearRect').length;
const fillsOf = (canvas) => (drawnPerCanvas.get(canvas) || []).filter((c) => c.startsWith('fillStyle=')).map((c) => c.slice(10));

// ---- 3. NOW import vue + the bundled adapter (jsdom globals are live) -----------------------------
const { createApp, createSSRApp, h, nextTick, reactive } = await import('vue');
const { renderToString } = await import('@vue/server-renderer');
const m = await import(pathToFileURL(tmp).href);
const { HalftoneProvider, useHalftoneContext, Surface, Text, Image, Button, Meter, Card, BarChart, LineChart, createPressContext } = m;
const tick = async (ms = 0) => { await nextTick(); if (ms) await new Promise((r) => setTimeout(r, ms)); };

// ---- 3b. SSR safety: server-render the adapter, no crash, no canvas access ------------------------
try {
  const ssrApp = createSSRApp({ render: () => h(HalftoneProvider, {}, () => h(Surface, { field: () => 0.5 })) });
  const htmlStr = await renderToString(ssrApp);
  ok('V-3 SSR: <Surface> server-renders without touching the DOM',
    /aria-hidden/.test(htmlStr) && /canvas/.test(htmlStr), htmlStr.slice(0, 60));
} catch (e) {
  ok('V-3 SSR: <Surface> server-renders without touching the DOM', false, e.message);
}

// ---- 4. Mount / set / destroy in a live tree ------------------------------------------------------
const ctx = createPressContext({});
const container = window.document.createElement('div');
window.document.body.appendChild(container);

const sState = reactive({ h: 80, screen: undefined, color: undefined });
const sApp = createApp({ render: () => h(HalftoneProvider, { context: ctx }, () => h(Surface, { field: () => 0.5, h: sState.h, screen: sState.screen, color: sState.color })) });

const baseSize = ctx.size;
sApp.mount(container);
await tick();
const canvas = container.querySelector('canvas');
ok('mount: surface registered on the shared context (size 0 -> 1)', ctx.size === baseSize + 1, `size=${ctx.size}`);
ok('mount: bound to the caller ref and drew (clearRect on that canvas)', canvas && clearsOf(canvas) >= 1, `clears=${canvas ? clearsOf(canvas) : 'n/a'}`);

const clearsBefore = clearsOf(canvas);
sState.screen = 'stipple';
await tick();
ok('set: a scalar-dial change (screen) re-presses via handle.set()', clearsOf(canvas) > clearsBefore, `clears ${clearsBefore} -> ${clearsOf(canvas)}`);

ok('color: a plain surface inks with a resolved fill (theme foreground, not default black)', fillsOf(canvas).length > 0 && fillsOf(canvas).every((c) => c && c !== '#000000'), `fills=${[...new Set(fillsOf(canvas))].join(',')}`);
sState.color = '#ff00ff';
await tick();
ok('color: an explicit color prop resolves to the canvas fillStyle', fillsOf(canvas).includes('#ff00ff'), `fills=${[...new Set(fillsOf(canvas))].join(',')}`);

sApp.unmount();
await tick();
ok('destroy: unmount drops the surface from the registry (size back to baseline — leak retired)', ctx.size === baseSize, `size=${ctx.size}`);

// ---- 4b. <Text>: rasterise the wordmark, push its height, press, clean up -------------------------
const tctx = createPressContext({});
const tcontainer = window.document.createElement('div');
window.document.body.appendChild(tcontainer);
const tState = reactive({ text: 'HALFTONE UI' });
const tApp = createApp({ render: () => h(HalftoneProvider, { context: tctx }, () => h(Text, { text: tState.text })) });
const tBase = tctx.size;
let threw = null;
try { tApp.mount(tcontainer); await tick(); } catch (e) { threw = e; }
const tcanvas = tcontainer.querySelector('canvas');
ok('Text: mounts + rasterises without throwing (textField over stubbed 2D ctx)', threw === null, threw?.message);
ok('Text: registered and drew on the shared context', tcanvas && tctx.size === tBase + 1 && clearsOf(tcanvas) >= 1, `size=${tctx.size} clears=${tcanvas ? clearsOf(tcanvas) : 'n/a'}`);
ok('Text: pushed the wordmark height through the press (canvas got a CSS height)', !!tcanvas && /\d/.test(tcanvas.style.height || ''), `height=${tcanvas?.style.height || '(none)'}`);
// Vue's watch is lazy — it never fires on setup — so a React-style "skip the first run" guard here
// would swallow the FIRST real change. Regression for exactly that: one text edit after mount must
// re-rasterise and re-press (h is a geometry key -> rebuild + draw -> a new clearRect).
const tClears = clearsOf(tcanvas);
tState.text = 'REPRINTED';
await tick();
ok('Text: the FIRST text change after mount re-rasterises and re-presses (lazy-watch, no skip guard)',
  clearsOf(tcanvas) > tClears, `clears ${tClears} -> ${clearsOf(tcanvas)}`);
tApp.unmount();
await tick();
ok('Text: unmount cleans up (registry back to baseline)', tctx.size === tBase, `size=${tctx.size}`);

// ---- 4c. <Image>: load, sample luminance, cancel a stale load, blank on '' / onerror, clean up ----
const ictx = createPressContext({});
const icontainer = window.document.createElement('div');
window.document.body.appendChild(icontainer);
const iState = reactive({ src: 'a.png', gamma: 1.3 });
const iApp = createApp({ render: () => h(HalftoneProvider, { context: ictx }, () => h(Image, { src: iState.src, gamma: iState.gamma })) });
const iBase = ictx.size;
iApp.mount(icontainer);
await tick();
const icanvas = icontainer.querySelector('canvas');
ok('Image: mounts and registers on the shared context', icanvas && ictx.size === iBase + 1, `size=${ictx.size}`);

const firstImg = madeImages[madeImages.length - 1];
const iClearsPre = clearsOf(icanvas);
firstImg.onload && firstImg.onload();
await tick();
ok('Image: luminance load re-presses the surface (draws again post-load)', clearsOf(icanvas) > iClearsPre, `clears ${iClearsPre} -> ${clearsOf(icanvas)}`);
ok('Image: took the image aspect ratio (no distortion by default)', !!icanvas && (icanvas.style.aspectRatio || '') !== '', `aspectRatio=${icanvas?.style.aspectRatio || '(none)'}`);

// swap src BEFORE firing the old (now superseded) load — the old load must never publish over the new one
iState.src = 'b.png';
await tick();
const secondImg = madeImages[madeImages.length - 1];
ok('Image: swapping src starts a new load (a distinct Image instance)', secondImg !== firstImg);
const clearsAtSwap = clearsOf(icanvas);
secondImg.onload && secondImg.onload();
await tick();
ok('Image: the CURRENT load publishes (redraw happened)', clearsOf(icanvas) > clearsAtSwap, `clears ${clearsAtSwap} -> ${clearsOf(icanvas)}`);
const clearsAfterCurrent = clearsOf(icanvas);
firstImg.onload && firstImg.onload(); // the stale, superseded load fires late
await tick();
ok('Image: firing the STALE (superseded) load does NOT publish (cancelled)', clearsOf(icanvas) === clearsAfterCurrent, `clears stayed at ${clearsAfterCurrent}, now ${clearsOf(icanvas)}`);

// set src to '' -> field blank (rebuild recorded)
const clearsBeforeEmpty = clearsOf(icanvas);
iState.src = '';
await tick();
ok("Image: setting src to '' blanks the field (rebuild recorded)", clearsOf(icanvas) > clearsBeforeEmpty, `clears ${clearsBeforeEmpty} -> ${clearsOf(icanvas)}`);

// onerror -> blank
iState.src = 'broken.png';
await tick();
const errImg = madeImages[madeImages.length - 1];
const clearsBeforeErr = clearsOf(icanvas);
errImg.onerror && errImg.onerror();
await tick();
ok('Image: onerror blanks the field (rebuild recorded)', clearsOf(icanvas) > clearsBeforeErr, `clears ${clearsBeforeErr} -> ${clearsOf(icanvas)}`);

// gamma/gain feed only the tone math, never geometry — the adapter should repaint (draw()) rather
// than rebuild() (which would re-run the Poisson point sampling). src is unchanged, so the load
// watch doesn't re-fire; only the [gamma, gain] watch should, and it must still visibly redraw.
const clearsBeforeGamma = clearsOf(icanvas);
iState.gamma = 1.8;
await tick();
ok('Image: a gamma-only change still repaints (tone-only; adapter uses draw(), not rebuild())', clearsOf(icanvas) > clearsBeforeGamma, `clears ${clearsBeforeGamma} -> ${clearsOf(icanvas)}`);

iApp.unmount();
await tick();
ok('Image: unmount cleans up (registry back to baseline)', ictx.size === iBase, `size=${ictx.size}`);

// ---- 4d. <Button>: real <button> + decorative press; a11y and clicks come from the DOM (V-10) -----
const bctx = createPressContext({});
const bcontainer = window.document.createElement('div');
window.document.body.appendChild(bcontainer);
const bState = reactive({ disabled: false });
let bClicks = 0;
const bApp = createApp({ render: () => h(HalftoneProvider, { context: bctx }, () => h(Button, { onClick: () => { bClicks++; }, disabled: bState.disabled }, () => 'Publish')) });
const bBase = bctx.size;
bApp.mount(bcontainer);
await tick();
const button = bcontainer.querySelector('button');
const bcanvas = bcontainer.querySelector('canvas');
ok('Button: renders a real <button> whose accessible name is DOM text, not the canvas',
  !!button && /Publish/.test(button.textContent || '') && !!bcanvas && bcanvas.getAttribute('aria-hidden') === 'true',
  `text=${button?.textContent} aria-hidden=${bcanvas?.getAttribute('aria-hidden')}`);
ok('Button: registered + drew the decorative fill on the shared context', bctx.size === bBase + 1 && clearsOf(bcanvas) >= 1, `size=${bctx.size}`);
button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
ok('Button: click reaches the native element (onClick fired once)', bClicks === 1, `clicks=${bClicks}`);
const bClears = clearsOf(bcanvas);
button.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
await tick(20);
ok('Button: a pointer-press ramps the ink in (canvas redrew via pressIn)', clearsOf(bcanvas) > bClears, `clears ${bClears} -> ${clearsOf(bcanvas)}`);
bState.disabled = true;
await tick();
ok('Button: native attributes forward (disabled reaches the <button>)', bcontainer.querySelector('button').disabled === true);
bApp.unmount();
await tick();
ok('Button: unmount cleans up (registry back to baseline)', bctx.size === bBase, `size=${bctx.size}`);

// ---- 4e. <Meter>: real <progress> holds value/max; the halftone bar mirrors value/max (V-10) ------
const mctx = createPressContext({});
const mcontainer = window.document.createElement('div');
window.document.body.appendChild(mcontainer);
const mState = reactive({ value: 0.4 });
const mApp = createApp({ render: () => h(HalftoneProvider, { context: mctx }, () => h(Meter, { value: mState.value })) });
const mBase = mctx.size;
mApp.mount(mcontainer);
await tick();
const progress = mcontainer.querySelector('progress');
const mcanvas = mcontainer.querySelector('canvas');
ok('Meter: renders a real <progress> carrying value/max (semantics in the a11y tree, not the canvas)',
  !!progress && Number(progress.value) === 0.4 && Number(progress.max) === 1 && !!mcanvas && mcanvas.getAttribute('aria-hidden') === 'true',
  `value=${progress?.value} max=${progress?.max}`);
const mClears = clearsOf(mcanvas);
mState.value = 0.9;
await tick();
ok('Meter: a value change re-presses the fill (canvas redrew)', clearsOf(mcanvas) > mClears, `clears ${mClears} -> ${clearsOf(mcanvas)}`);
ok('Meter: the new value is reflected on the native <progress>', Number(mcontainer.querySelector('progress').value) === 0.9, `value=${mcontainer.querySelector('progress').value}`);
mApp.unmount();
await tick();
ok('Meter: unmount cleans up (registry back to baseline)', mctx.size === mBase, `size=${mctx.size}`);

// ---- 4f. <Card>: real children + decorative backdrop; meaning lives in the DOM (V-10) -------------
const cctx = createPressContext({});
const ccontainer = window.document.createElement('div');
window.document.body.appendChild(ccontainer);
const cState = reactive({ as: 'div' });
const cApp = createApp({ render: () => h(HalftoneProvider, { context: cctx }, () => h(Card, { as: cState.as }, () => h('h3', null, 'Plate registration'))) });
const cBase = cctx.size;
cApp.mount(ccontainer);
await tick();
const heading = ccontainer.querySelector('h3');
const ccanvas = ccontainer.querySelector('canvas');
ok('Card: children are real DOM (heading present); the backdrop is a decorative aria-hidden canvas',
  !!heading && /Plate registration/.test(heading.textContent || '') && !!ccanvas && ccanvas.getAttribute('aria-hidden') === 'true');
ok('Card: registered + drew the backdrop on the shared context', cctx.size === cBase + 1 && clearsOf(ccanvas) >= 1, `size=${cctx.size}`);
cState.as = 'article';
await tick();
ok('Card: `as` renders the chosen semantic element (<article>)', !!ccontainer.querySelector('article'));
cApp.unmount();
await tick();
ok('Card: unmount cleans up (registry back to baseline)', cctx.size === cBase, `size=${cctx.size}`);

// ---- 4g. <BarChart>/<LineChart>: data in a real accessible <table>, halftone is decorative (V-10) -
const chctx = createPressContext({});
const chcontainer = window.document.createElement('div');
window.document.body.appendChild(chcontainer);
const chState = reactive({ data: [4, 9, 6] });
const chApp = createApp({ render: () => h(HalftoneProvider, { context: chctx }, () => h(BarChart, { data: chState.data, caption: 'Weekly impressions' })) });
const chBase = chctx.size;
chApp.mount(chcontainer);
await tick();
const table = chcontainer.querySelector('table');
const rows = table ? table.querySelectorAll('tbody tr') : [];
const chcanvas = chcontainer.querySelector('canvas');
ok('BarChart: data lives in a real <table> (caption + one row per datum) in the a11y tree, not the canvas',
  !!table && rows.length === 3 && /Weekly impressions/.test(table.querySelector('caption')?.textContent || '') && !!chcanvas && chcanvas.getAttribute('aria-hidden') === 'true',
  `rows=${rows.length}`);
ok('BarChart: each row carries a scoped label + value cell (the accessible readout)',
  rows.length === 3 && /9/.test(rows[1].textContent || '') && rows[1].querySelector('th[scope="row"]') && rows[1].querySelector('td'),
  `row1=${rows[1]?.textContent}`);
ok('BarChart: registered + drew the bars on the shared context', chctx.size === chBase + 1 && clearsOf(chcanvas) >= 1, `size=${chctx.size}`);
const chClears = clearsOf(chcanvas);
chState.data = [4, 9, 6, 12];
await tick();
ok('BarChart: a data change re-presses (canvas redrew) and the <table> grows a row',
  clearsOf(chcanvas) > chClears && chcontainer.querySelectorAll('tbody tr').length === 4,
  `clears ${chClears} -> ${clearsOf(chcanvas)} rows=${chcontainer.querySelectorAll('tbody tr').length}`);
chApp.unmount();
await tick();
ok('BarChart: unmount cleans up (registry back to baseline)', chctx.size === chBase, `size=${chctx.size}`);

const lctx = createPressContext({});
const lcontainer = window.document.createElement('div');
window.document.body.appendChild(lcontainer);
const lApp = createApp({ render: () => h(HalftoneProvider, { context: lctx }, () => h(LineChart, { data: [{ label: 'Jan', value: 3 }, { label: 'Feb', value: 8 }], area: true, caption: 'Ink-up' })) });
const lBase = lctx.size;
lApp.mount(lcontainer);
await tick();
const ltable = lcontainer.querySelector('table');
const lcanvas = lcontainer.querySelector('canvas');
ok('LineChart: accepts {label,value} rows into the real <table>; canvas is decorative aria-hidden',
  !!ltable && ltable.querySelectorAll('tbody tr').length === 2 && /Feb/.test(ltable.textContent || '') && lcanvas.getAttribute('aria-hidden') === 'true');
ok('LineChart: registered + drew the area on the shared context', lctx.size === lBase + 1 && clearsOf(lcanvas) >= 1, `size=${lctx.size}`);
lApp.unmount();
await tick();
ok('LineChart: unmount cleans up (registry back to baseline)', lctx.size === lBase, `size=${lctx.size}`);

// ---- 4h. aria-hidden is NON-overridable on every canvas primitive (V-10 decorative invariant) -----
const actx = createPressContext({});
const acont = window.document.createElement('div');
window.document.body.appendChild(acont);
const aApp = createApp({
  render: () => h(HalftoneProvider, { context: actx }, () => h('div', null, [
    h(Surface, { field: () => 0.5, 'aria-hidden': 'false' }),
    h(Text, { text: 'X', 'aria-hidden': 'false' }),
    h(Image, { src: 'x.png', 'aria-hidden': 'false' }),
  ])),
});
aApp.mount(acont);
await tick();
const primCanvases = acont.querySelectorAll('canvas');
ok('aria-hidden: a caller cannot expose any canvas primitive to the a11y tree (Surface/Text/Image)',
  primCanvases.length === 3 && [...primCanvases].every((c) => c.getAttribute('aria-hidden') === 'true'),
  `values=${[...primCanvases].map((c) => c.getAttribute('aria-hidden')).join(',')}`);
aApp.unmount();
await tick();

// ---- 5. Two providers hold independent state (blocker 2) ------------------------------------------
const a = createPressContext({ mode: 'dark' });
const b = createPressContext({ mode: 'light' });
b.setTheme({ hue: 42 });
ok('blocker 2: two contexts are independent (a.mode dark, b.mode light, b.hue 42)',
  a.theme.mode === 'dark' && b.theme.mode === 'light' && b.theme.hue === 42 && a.theme.hue === 0);

fs.unlinkSync(tmp);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
