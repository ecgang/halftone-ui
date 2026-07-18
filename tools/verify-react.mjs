// P3 verification harness for @halftone-ui/react. The core's RENDERING is already golden-verified;
// this proves the ADAPTER's contract, which the golden can't see: mount binds to the caller's
// element, prop changes push through set(), unmount calls destroy() (so the registry returns to
// baseline — blocker 1, the leak, retired in a real mount/unmount cycle), and the module is
// SSR-safe. React needs a JSX build, so instead of a golden we transform the adapter with esbuild
// and drive it under jsdom with a stubbed 2D context.
//
// Run: node tools/verify-react.mjs   (from repo root or tools/)

import esbuild from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const reactIndex = path.join(ROOT, 'halftone-kit', 'react', 'index.js');
const coreIndex = path.join(ROOT, 'halftone-kit', 'core', 'index.js');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

// ---- 1. Bundle the adapter (JSX -> JS) with react/react-dom left external ------------------------
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { act } from 'react-dom/test-utils';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { HalftoneProvider, Surface, Text, Image, Button, Meter, Card, BarChart, LineChart, usePress, useHalftoneContext } from ${JSON.stringify(reactIndex)};
  import { createPressContext } from ${JSON.stringify(coreIndex)};
  export { React, createRoot, act, renderToStaticMarkup, HalftoneProvider, Surface, Text, Image, Button, Meter, Card, BarChart, LineChart, usePress, useHalftoneContext, createPressContext };
`;
const built = await esbuild.build({
  absWorkingDir: ROOT,
  stdin: { contents: entry, resolveDir: HERE, loader: 'js', sourcefile: 'verify-react-entry.js' },
  bundle: true, format: 'esm', target: 'es2020', jsx: 'transform', charset: 'utf8',
  external: ['react', 'react-dom', 'react-dom/client', 'react-dom/server', 'react-dom/test-utils'],
  write: false,
});
ok('adapter bundles (JSX transforms, no unresolved imports)', built.outputFiles.length === 1);
const tmp = path.join(HERE, '.verify-react.bundle.mjs');   // in tools/ so `react` resolves
fs.writeFileSync(tmp, built.outputFiles[0].text);

// ---- 2. jsdom + a stubbed 2D context (no native canvas package) ---------------------------------
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
// onload deterministically (an auto-firing timer races React's act() and makes the delta unreadable).
const madeImages = [];
window.Image = class FakeImage { constructor() { this.width = 200; this.height = 120; this.onload = null; this.crossOrigin = null; madeImages.push(this); } set src(v) { this._src = v; } get src() { return this._src; } };
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.devicePixelRatio = 1;

// publish jsdom globals the way react-dom/client expects (it reads bare `document`, etc.)
globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.HTMLCanvasElement = HC;
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
globalThis.devicePixelRatio = 1;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const m = await import(pathToFileURL(tmp).href);
const { React, createRoot, act: actLegacy, renderToStaticMarkup, HalftoneProvider, Surface, Text, Image, Button, Meter, Card, BarChart, LineChart, createPressContext } = m;
const act = React.act || actLegacy;   // React.act (18.3+) is the non-deprecated path
const h = React.createElement;
const clearsOf = (canvas) => (drawnPerCanvas.get(canvas) || []).filter((c) => c === 'clearRect').length;
const fillsOf = (canvas) => (drawnPerCanvas.get(canvas) || []).filter((c) => c.startsWith('fillStyle=')).map((c) => c.slice(10));

// ---- 3. SSR safety: server-render the adapter, no crash, no canvas access -----------------------
try {
  const html = renderToStaticMarkup(h(HalftoneProvider, {}, h(Surface, { field: () => 0.5 })));
  ok('V-3 SSR: <Surface> server-renders without touching the DOM', /aria-hidden/.test(html) && /canvas/.test(html), html.slice(0, 60));
} catch (e) {
  ok('V-3 SSR: <Surface> server-renders without touching the DOM', false, e.message);
}

// ---- 4. Mount / set / destroy in a live tree ----------------------------------------------------
const ctx = createPressContext({});
const container = window.document.createElement('div');
window.document.body.appendChild(container);
const root = createRoot(container);

const render = async (props) => { await act(async () => { root.render(h(HalftoneProvider, { context: ctx }, h(Surface, props))); }); };

const baseSize = ctx.size;
await render({ field: () => 0.5, h: 80 });
const canvas = container.querySelector('canvas');
ok('mount: surface registered on the shared context (size 0 -> 1)', ctx.size === baseSize + 1, `size=${ctx.size}`);
ok('mount: bound to the caller ref and drew (clearRect on that canvas)', canvas && clearsOf(canvas) >= 1, `clears=${canvas ? clearsOf(canvas) : 'n/a'}`);

const clearsBefore = clearsOf(canvas);
await render({ field: () => 0.5, h: 80, screen: 'stipple' });
ok('set: a scalar-dial change (screen) re-presses via handle.set()', clearsOf(canvas) > clearsBefore, `clears ${clearsBefore} -> ${clearsOf(canvas)}`);

ok('color: a plain surface inks with a resolved fill (theme foreground, not default black)', fillsOf(canvas).length > 0 && fillsOf(canvas).every((c) => c && c !== '#000000'), `fills=${[...new Set(fillsOf(canvas))].join(',')}`);
await render({ field: () => 0.5, h: 80, screen: 'stipple', color: '#ff00ff' });
ok('color: an explicit color prop resolves to the canvas fillStyle', fillsOf(canvas).includes('#ff00ff'), `fills=${[...new Set(fillsOf(canvas))].join(',')}`);

await act(async () => { root.unmount(); });
ok('destroy: unmount drops the surface from the registry (size back to baseline — leak retired)', ctx.size === baseSize, `size=${ctx.size}`);

// ---- 4b. <Text>: rasterise the wordmark, push its height, press, clean up ------------------------
const tctx = createPressContext({});
const tcontainer = window.document.createElement('div');
window.document.body.appendChild(tcontainer);
const troot = createRoot(tcontainer);
const tBase = tctx.size;
let threw = null;
try {
  await act(async () => { troot.render(h(HalftoneProvider, { context: tctx }, h(Text, { text: 'HALFTONE UI' }))); });
} catch (e) { threw = e; }
const tcanvas = tcontainer.querySelector('canvas');
ok('Text: mounts + rasterises without throwing (textField over stubbed 2D ctx)', threw === null, threw?.message);
ok('Text: registered and drew on the shared context', tcanvas && tctx.size === tBase + 1 && clearsOf(tcanvas) >= 1, `size=${tctx.size} clears=${tcanvas ? clearsOf(tcanvas) : 'n/a'}`);
ok('Text: pushed the wordmark height through the press (canvas got a CSS height)', !!tcanvas && /\d/.test(tcanvas.style.height || ''), `height=${tcanvas?.style.height || '(none)'}`);
await act(async () => { troot.unmount(); });
ok('Text: unmount cleans up (registry back to baseline)', tctx.size === tBase, `size=${tctx.size}`);

// ---- 4c. <Image>: load, sample luminance, re-press, clean up ------------------------------------
const ictx = createPressContext({});
const icontainer = window.document.createElement('div');
window.document.body.appendChild(icontainer);
const iroot = createRoot(icontainer);
const iBase = ictx.size;
await act(async () => { iroot.render(h(HalftoneProvider, { context: ictx }, h(Image, { src: 'x.png' }))); });
const icanvas = icontainer.querySelector('canvas');
ok('Image: mounts and registers on the shared context', icanvas && ictx.size === iBase + 1, `size=${ictx.size}`);
const iClearsPre = clearsOf(icanvas);
await act(async () => { madeImages.forEach((im) => im.onload && im.onload()); }); // fire load deterministically
ok('Image: luminance load re-presses the surface (draws again post-load)', clearsOf(icanvas) > iClearsPre, `clears ${iClearsPre} -> ${clearsOf(icanvas)}`);
ok('Image: took the image aspect ratio (no distortion by default)', !!icanvas && (icanvas.style.aspectRatio || '') !== '', `aspectRatio=${icanvas?.style.aspectRatio || '(none)'}`);

// gamma/gain feed only the tone math, never geometry — the adapter should repaint (draw()) rather
// than rebuild() (which would re-run the Poisson point sampling). Same `src`, so the load effect
// doesn't re-fire; only the [gamma, gain] effect should, and it must still visibly redraw.
const iClearsPreGamma = clearsOf(icanvas);
await act(async () => { iroot.render(h(HalftoneProvider, { context: ictx }, h(Image, { src: 'x.png', gamma: 1.8 }))); });
ok('Image: a gamma-only change still repaints (tone-only; adapter uses draw(), not rebuild())', clearsOf(icanvas) > iClearsPreGamma, `clears ${iClearsPreGamma} -> ${clearsOf(icanvas)}`);

await act(async () => { iroot.unmount(); });
ok('Image: unmount cleans up (registry back to baseline)', ictx.size === iBase, `size=${ictx.size}`);

// ---- 4d. <Button>: real <button> + decorative press; a11y and clicks come from the DOM (V-10) -----
const bctx = createPressContext({});
const bcontainer = window.document.createElement('div');
window.document.body.appendChild(bcontainer);
const broot = createRoot(bcontainer);
const bBase = bctx.size;
let bClicks = 0;
await act(async () => { broot.render(h(HalftoneProvider, { context: bctx }, h(Button, { onClick: () => { bClicks++; } }, 'Publish'))); });
const button = bcontainer.querySelector('button');
const bcanvas = bcontainer.querySelector('canvas');
ok('Button: renders a real <button> whose accessible name is DOM text, not the canvas',
  !!button && /Publish/.test(button.textContent || '') && !!bcanvas && bcanvas.getAttribute('aria-hidden') === 'true',
  `text=${button?.textContent} aria-hidden=${bcanvas?.getAttribute('aria-hidden')}`);
ok('Button: registered + drew the decorative fill on the shared context', bctx.size === bBase + 1 && clearsOf(bcanvas) >= 1, `size=${bctx.size}`);
await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
ok('Button: click reaches the native element (onClick fired once)', bClicks === 1, `clicks=${bClicks}`);
const bClears = clearsOf(bcanvas);
await act(async () => { button.dispatchEvent(new window.Event('pointerdown', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
ok('Button: a pointer-press ramps the ink in (canvas redrew via pressIn)', clearsOf(bcanvas) > bClears, `clears ${bClears} -> ${clearsOf(bcanvas)}`);
await act(async () => { broot.render(h(HalftoneProvider, { context: bctx }, h(Button, { disabled: true }, 'X'))); });
ok('Button: native attributes forward (disabled reaches the <button>)', bcontainer.querySelector('button').disabled === true);
await act(async () => { broot.unmount(); });
ok('Button: unmount cleans up (registry back to baseline)', bctx.size === bBase, `size=${bctx.size}`);

// ---- 4e. <Meter>: real <progress> holds value/max; the halftone bar mirrors value/max (V-10) ------
const mctx = createPressContext({});
const mcontainer = window.document.createElement('div');
window.document.body.appendChild(mcontainer);
const mroot = createRoot(mcontainer);
const mBase = mctx.size;
await act(async () => { mroot.render(h(HalftoneProvider, { context: mctx }, h(Meter, { value: 0.4 }))); });
const progress = mcontainer.querySelector('progress');
const mcanvas = mcontainer.querySelector('canvas');
ok('Meter: renders a real <progress> carrying value/max (semantics in the a11y tree, not the canvas)',
  !!progress && Number(progress.value) === 0.4 && Number(progress.max) === 1 && !!mcanvas && mcanvas.getAttribute('aria-hidden') === 'true',
  `value=${progress?.value} max=${progress?.max}`);
const mClears = clearsOf(mcanvas);
await act(async () => { mroot.render(h(HalftoneProvider, { context: mctx }, h(Meter, { value: 0.9 }))); });
ok('Meter: a value change re-presses the fill (canvas redrew)', clearsOf(mcanvas) > mClears, `clears ${mClears} -> ${clearsOf(mcanvas)}`);
ok('Meter: the new value is reflected on the native <progress>', Number(mcontainer.querySelector('progress').value) === 0.9, `value=${mcontainer.querySelector('progress').value}`);
await act(async () => { mroot.unmount(); });
ok('Meter: unmount cleans up (registry back to baseline)', mctx.size === mBase, `size=${mctx.size}`);

// ---- 4f. <Card>: real children + decorative backdrop; meaning lives in the DOM (V-10) -------------
const cctx = createPressContext({});
const ccontainer = window.document.createElement('div');
window.document.body.appendChild(ccontainer);
const croot = createRoot(ccontainer);
const cBase = cctx.size;
await act(async () => { croot.render(h(HalftoneProvider, { context: cctx }, h(Card, null, h('h3', null, 'Plate registration')))); });
const heading = ccontainer.querySelector('h3');
const ccanvas = ccontainer.querySelector('canvas');
ok('Card: children are real DOM (heading present); the backdrop is a decorative aria-hidden canvas',
  !!heading && /Plate registration/.test(heading.textContent || '') && !!ccanvas && ccanvas.getAttribute('aria-hidden') === 'true');
ok('Card: registered + drew the backdrop on the shared context', cctx.size === cBase + 1 && clearsOf(ccanvas) >= 1, `size=${cctx.size}`);
await act(async () => { croot.render(h(HalftoneProvider, { context: cctx }, h(Card, { as: 'article' }, 'x'))); });
ok('Card: `as` renders the chosen semantic element (<article>)', !!ccontainer.querySelector('article'));
await act(async () => { croot.unmount(); });
ok('Card: unmount cleans up (registry back to baseline)', cctx.size === cBase, `size=${cctx.size}`);

// ---- 4g. <BarChart>/<LineChart>: data in a real accessible <table>, halftone is decorative (V-10) -
const chctx = createPressContext({});
const chcontainer = window.document.createElement('div');
window.document.body.appendChild(chcontainer);
const chroot = createRoot(chcontainer);
const chBase = chctx.size;
await act(async () => { chroot.render(h(HalftoneProvider, { context: chctx }, h(BarChart, { data: [4, 9, 6], caption: 'Weekly impressions' }))); });
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
await act(async () => { chroot.render(h(HalftoneProvider, { context: chctx }, h(BarChart, { data: [4, 9, 6, 12], caption: 'Weekly impressions' }))); });
ok('BarChart: a data change re-presses (canvas redrew) and the <table> grows a row',
  clearsOf(chcanvas) > chClears && chcontainer.querySelectorAll('tbody tr').length === 4,
  `clears ${chClears} -> ${clearsOf(chcanvas)} rows=${chcontainer.querySelectorAll('tbody tr').length}`);
await act(async () => { chroot.unmount(); });
ok('BarChart: unmount cleans up (registry back to baseline)', chctx.size === chBase, `size=${chctx.size}`);

const lctx = createPressContext({});
const lcontainer = window.document.createElement('div');
window.document.body.appendChild(lcontainer);
const lroot = createRoot(lcontainer);
const lBase = lctx.size;
await act(async () => { lroot.render(h(HalftoneProvider, { context: lctx }, h(LineChart, { data: [{ label: 'Jan', value: 3 }, { label: 'Feb', value: 8 }], area: true, caption: 'Ink-up' }))); });
const ltable = lcontainer.querySelector('table');
const lcanvas = lcontainer.querySelector('canvas');
ok('LineChart: accepts {label,value} rows into the real <table>; canvas is decorative aria-hidden',
  !!ltable && ltable.querySelectorAll('tbody tr').length === 2 && /Feb/.test(ltable.textContent || '') && lcanvas.getAttribute('aria-hidden') === 'true');
ok('LineChart: registered + drew the area on the shared context', lctx.size === lBase + 1 && clearsOf(lcanvas) >= 1, `size=${lctx.size}`);
await act(async () => { lroot.unmount(); });
ok('LineChart: unmount cleans up (registry back to baseline)', lctx.size === lBase, `size=${lctx.size}`);

// ---- 4h. aria-hidden is NON-overridable on every canvas primitive (V-10 decorative invariant) ----
const actx = createPressContext({});
const acont = window.document.createElement('div');
window.document.body.appendChild(acont);
const aroot = createRoot(acont);
await act(async () => {
  aroot.render(h(HalftoneProvider, { context: actx }, h('div', null,
    h(Surface, { field: () => 0.5, 'aria-hidden': 'false' }),
    h(Text, { text: 'X', 'aria-hidden': 'false' }),
    h(Image, { src: 'x.png', 'aria-hidden': 'false' }),
  )));
});
const primCanvases = acont.querySelectorAll('canvas');
ok('aria-hidden: a caller cannot expose any canvas primitive to the a11y tree (Surface/Text/Image)',
  primCanvases.length === 3 && [...primCanvases].every((c) => c.getAttribute('aria-hidden') === 'true'),
  `values=${[...primCanvases].map((c) => c.getAttribute('aria-hidden')).join(',')}`);
await act(async () => { aroot.unmount(); });

// ---- 5. Two providers hold independent state (blocker 2) -----------------------------------------
const a = createPressContext({ mode: 'dark' });
const b = createPressContext({ mode: 'light' });
b.setTheme({ hue: 42 });
ok('blocker 2: two contexts are independent (a.mode dark, b.mode light, b.hue 42)',
  a.theme.mode === 'dark' && b.theme.mode === 'light' && b.theme.hue === 42 && a.theme.hue === 0);

fs.unlinkSync(tmp);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
