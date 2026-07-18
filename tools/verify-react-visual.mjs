// Real-pixel check for @halftone-ui/react. The jsdom harness (verify-react.mjs) proves the adapter
// LIFECYCLE; this proves it actually RENDERS. It esbuild-bundles React + the adapter into one IIFE,
// inlines it into a self-contained page, mounts Surface/Text/Image in real headless Chromium, and
// asserts every canvas carries ink — then writes a screenshot to eyeball.
//
// Run: node tools/verify-react-visual.mjs   (writes tools/.verify-react-visual.png)

import esbuild from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const reactIndex = path.join(ROOT, 'halftone-kit', 'react', 'index.js');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

// ---- the demo app (bundled with React into an IIFE) ---------------------------------------------
const app = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { HalftoneProvider, Surface, Text, Image, Button, Meter, Card, BarChart, LineChart } from ${JSON.stringify(reactIndex)};

  const gradient = (u, v) => Math.max(0, Math.min(1, 1 - (u * 0.5 + v * 0.5) + 0.15 * Math.sin(u * 18)));
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='130'>"
    + "<linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>"
    + "<stop offset='0' stop-color='black'/><stop offset='1' stop-color='white'/></linearGradient>"
    + "<rect width='220' height='130' fill='url(#g)'/>"
    + "<circle cx='150' cy='55' r='34' fill='black'/></svg>";
  const imgSrc = 'data:image/svg+xml,' + encodeURIComponent(svg);
  // A TRANSPARENT-background image (no rect fill) with one opaque black shape — the alpha regression.
  const svgAlpha = "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='120'>"
    + "<circle cx='100' cy='60' r='42' fill='black'/></svg>";
  const imgAlphaSrc = 'data:image/svg+xml,' + encodeURIComponent(svgAlpha);
  const BROKEN = 'data:image/png;base64,Zm9v'; // decodes to "foo" — not a valid image, fires onerror

  // Starts on the opaque gradient (inks); clicking swaps the src to the "to" prop. The surface must
  // go BLANK, not keep showing the old image (the stale-content regression Codex flagged). Two
  // instances cover both paths: a BROKEN src (onerror) and REMOVING the src (empty falsy early-return).
  function SwapImage({ box, btn, to }) {
    const [swapped, setSwapped] = React.useState(false);
    return React.createElement('div', { 'data-box': box },
      React.createElement('button', { id: btn, onClick: () => setSwapped(true) }, 'swap'),
      React.createElement(Image, { src: swapped ? to : imgSrc, screen: 'stipple', color: 'blue', h: 120 }));
  }

  function App() {
    return React.createElement(HalftoneProvider, { mode: 'dark' },
      React.createElement('div', { style: { display: 'grid', gap: 24, padding: 24, width: 360 } },
        React.createElement('div', { 'data-box': 'surface' },
          React.createElement(Surface, { field: gradient, screen: 'stipple', h: 120, color: 'blue' })),
        React.createElement('div', { 'data-box': 'wash1' },
          React.createElement(Surface, { field: () => 0.6, screen: 'stipple', scale: 1, seed: 42, h: 120, color: 'blue', wash: 1 })),
        React.createElement('div', { 'data-box': 'wash03' },
          React.createElement(Surface, { field: () => 0.6, screen: 'stipple', scale: 1, seed: 42, h: 120, color: 'blue', wash: 0.3 })),
        React.createElement('div', { 'data-box': 'text' },
          React.createElement(Text, { text: 'HALFTONE UI', screen: 'stipple' })),
        React.createElement('div', { 'data-box': 'image' },
          React.createElement(Image, { src: imgSrc, screen: 'stipple' })),
        React.createElement('div', { 'data-box': 'button' },
          React.createElement(Button, { color: 'blue', screen: 'stipple',
            style: { border: 0, padding: '12px 20px', color: '#0B0C10', font: '600 15px system-ui', cursor: 'pointer' } },
            'Publish')),
        React.createElement('div', { 'data-box': 'meter' },
          React.createElement(Meter, { value: 0.66, color: 'blue', screen: 'stipple', h: 16 })),
        React.createElement('div', { 'data-box': 'card', style: { minHeight: 64 } },
          React.createElement(Card, { color: 'blue', screen: 'stipple',
            style: { padding: 16, color: '#F2EFE6', font: '15px system-ui' } },
            React.createElement('h3', { style: { margin: 0 } }, 'Plate registration'))),
        React.createElement('div', { 'data-box': 'bar' },
          React.createElement(BarChart, { data: [4, 9, 6, 11, 7], caption: 'Impressions by week', color: 'blue', screen: 'stipple', h: 120 })),
        React.createElement('div', { 'data-box': 'line' },
          React.createElement(LineChart, { data: [3, 6, 4, 9, 7, 12], area: true, caption: 'Ink-up over time', color: 'blue', screen: 'stipple', h: 120 })),
        React.createElement('div', { 'data-box': 'imgalpha' },
          React.createElement(Image, { src: imgAlphaSrc, screen: 'stipple', color: 'blue', h: 120 })),
        React.createElement(SwapImage, { box: 'swapbroken', btn: 'swap-broken', to: BROKEN }),
        React.createElement(SwapImage, { box: 'swapempty', btn: 'swap-empty', to: '' }),
      ),
    );
  }
  createRoot(document.getElementById('root')).render(React.createElement(App));
`;
const built = await esbuild.build({
  absWorkingDir: ROOT,
  stdin: { contents: app, resolveDir: HERE, loader: 'js', sourcefile: 'demo.jsx' },
  bundle: true, format: 'iife', target: 'es2020', jsx: 'transform', charset: 'utf8',
  define: { 'process.env.NODE_ENV': '"production"' }, write: false,
  nodePaths: [path.join(HERE, 'node_modules')], // react/react-dom live in tools/, not at ROOT
});
ok('demo bundles (React + adapter -> one IIFE)', built.outputFiles.length === 1);
const html = `<!doctype html><html><head><meta charset="utf8"><style>
  :root{--ink:#F2EFE6;--blue:#4C8DFF}
  html,body{margin:0;background:#0B0C10}</style></head><body>
  <div id="root"></div><script>${built.outputFiles[0].text}</script></body></html>`;
const htmlPath = path.join(HERE, '.verify-react-visual.html');
fs.writeFileSync(htmlPath, html);

// ---- drive it in real Chromium ------------------------------------------------------------------
const browser = await chromium.launch({ args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 420, height: 640 }, deviceScaleFactor: 1 });
const errors = [];
// Keep real JS console errors; ignore the expected broken-resource noise from the stale-swap test.
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load|ERR_|net::/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(htmlPath).href);

// wait until all three canvases have painted ink (Image is async on its data-URI load)
let inks = [];
try {
  await page.waitForFunction(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (cs.length < 13) return false;
    return cs.every((cv) => {
      if (!cv.width) return false;
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 10) return true;
      return false;
    });
  }, { timeout: 5000 });
} catch (e) { /* fall through to the per-canvas report */ }

inks = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((cv) => {
  if (!cv.width) return { w: 0, h: 0, ink: 0 };
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) ink++;
  return { w: cv.width, h: cv.height, ink };
}));

// Alpha regression: a transparent-background image must ink ONLY its opaque shape. A blank corner
// (transparent) + an inked center (the black circle) proves transparent pixels aren't read as black.
const alpha = await page.evaluate(() => {
  const cv = document.querySelector('[data-box="imgalpha"] canvas');
  if (!cv || !cv.width) return null;
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const inkIn = (x0, y0, x1, y1) => {
    const d = g.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++; return n;
  };
  return {
    corner: inkIn(0, 0, Math.floor(W * 0.18), Math.floor(H * 0.18)),
    center: inkIn(Math.floor(W * 0.4), Math.floor(H * 0.38), Math.floor(W * 0.6), Math.floor(H * 0.62)),
  };
});

// Stale-content regression: swap an image away from a valid src and confirm the surface goes BLANK,
// not keeps the old image. Covers BOTH a broken src (onerror) and removing the src ('' falsy path).
const inkOf = (sel) => page.evaluate((s) => {
  const cv = document.querySelector(s);
  if (!cv || !cv.width) return -1;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++; return n;
}, sel);
const swapGoesBlank = async (box, btn) => {
  const sel = `[data-box="${box}"] canvas`;
  const before = await inkOf(sel);
  await page.click('#' + btn);
  await page.waitForFunction((s) => {
    const cv = document.querySelector(s);
    if (!cv || !cv.width) return false;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) return false;
    return true;
  }, sel, { timeout: 4000 }).catch(() => {});
  return { before, after: await inkOf(sel) };
};
const swBroken = await swapGoesBlank('swapbroken', 'swap-broken');
const swEmpty = await swapGoesBlank('swapempty', 'swap-empty');

// plan 006: wash actually scales the field tone -- an identical field/seed/size Surface at
// wash 0.3 must ink strictly fewer pixels than one at wash 1 (and still ink something, > 0).
const inkCount = (sel) => page.evaluate((s) => {
  const cv = document.querySelector(s);
  if (!cv || !cv.width) return -1;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++; return n;
}, sel);
const washInk1 = await inkCount('[data-box="wash1"] canvas');
const washInk03 = await inkCount('[data-box="wash03"] canvas');

const pngPath = path.join(HERE, '.verify-react-visual.png');
await page.screenshot({ path: pngPath, fullPage: true });
await browser.close();

const label = ['Surface (gradient)', 'Surface (wash 1.0)', 'Surface (wash 0.3)', 'Text (HALFTONE UI)', 'Image (luminance)', 'Button (solid plate)', 'Meter (0.66 fill)', 'Card (whisper backdrop)', 'BarChart (5 bars)', 'LineChart (area)', 'Image (transparent bg)', 'Image (swap-broken, pre-click)', 'Image (swap-empty, pre-click)'];
ok('thirteen canvases mounted', inks.length === 13, `count=${inks.length}`);
inks.forEach((c, i) => ok(`${label[i] || 'canvas ' + i}: real ink drawn`, c.ink > 0, `${c.w}x${c.h}, inkPx=${c.ink}`));
ok('alpha regression: a transparent background inks nothing (blank corner)', alpha && alpha.corner === 0, `corner=${alpha?.corner}`);
ok('alpha regression: the opaque shape still inks (center has ink)', alpha && alpha.center > 0, `center=${alpha?.center}`);
ok('stale regression: valid images ink before the swap (broken + empty cases)', swBroken.before > 0 && swEmpty.before > 0, `broken=${swBroken.before} empty=${swEmpty.before}`);
ok('stale regression: swapping to a BROKEN src goes BLANK (onerror -> not stale)', swBroken.after === 0, `after=${swBroken.after}`);
ok('stale regression: REMOVING the src (empty) goes BLANK (falsy path -> not stale)', swEmpty.after === 0, `after=${swEmpty.after}`);
ok('wash: identical field/seed inks strictly fewer pixels at wash 0.3 than wash 1', washInk03 > 0 && washInk03 < washInk1, `wash1=${washInk1} wash0.3=${washInk03}`);
ok('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\nscreenshot: ${pngPath}`);

fs.unlinkSync(htmlPath);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
