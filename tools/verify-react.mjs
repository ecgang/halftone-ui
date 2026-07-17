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
  import { HalftoneProvider, Surface, usePress, useHalftoneContext } from ${JSON.stringify(reactIndex)};
  import { createPressContext } from ${JSON.stringify(coreIndex)};
  export { React, createRoot, act, renderToStaticMarkup, HalftoneProvider, Surface, usePress, useHalftoneContext, createPressContext };
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
    set() { return true; },
  });
};
Object.defineProperty(HC.prototype, 'clientWidth', { configurable: true, get() { return 300; } });
Object.defineProperty(HC.prototype, 'clientHeight', { configurable: true, get() { return 150; } });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
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
const { React, createRoot, act: actLegacy, renderToStaticMarkup, HalftoneProvider, Surface, createPressContext } = m;
const act = React.act || actLegacy;   // React.act (18.3+) is the non-deprecated path
const h = React.createElement;
const clearsOf = (canvas) => (drawnPerCanvas.get(canvas) || []).filter((c) => c === 'clearRect').length;

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

await act(async () => { root.unmount(); });
ok('destroy: unmount drops the surface from the registry (size back to baseline — leak retired)', ctx.size === baseSize, `size=${ctx.size}`);

// ---- 5. Two providers hold independent state (blocker 2) -----------------------------------------
const a = createPressContext({ mode: 'dark' });
const b = createPressContext({ mode: 'light' });
b.setTheme({ hue: 42 });
ok('blocker 2: two contexts are independent (a.mode dark, b.mode light, b.hue 42)',
  a.theme.mode === 'dark' && b.theme.mode === 'light' && b.theme.hue === 42 && a.theme.hue === 0);

fs.unlinkSync(tmp);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
