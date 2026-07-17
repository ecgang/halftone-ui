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
  import { HalftoneProvider, Surface, Text, Image, Button, Meter, Card } from ${JSON.stringify(reactIndex)};

  const gradient = (u, v) => Math.max(0, Math.min(1, 1 - (u * 0.5 + v * 0.5) + 0.15 * Math.sin(u * 18)));
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='130'>"
    + "<linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>"
    + "<stop offset='0' stop-color='black'/><stop offset='1' stop-color='white'/></linearGradient>"
    + "<rect width='220' height='130' fill='url(#g)'/>"
    + "<circle cx='150' cy='55' r='34' fill='black'/></svg>";
  const imgSrc = 'data:image/svg+xml,' + encodeURIComponent(svg);

  function App() {
    return React.createElement(HalftoneProvider, { mode: 'dark' },
      React.createElement('div', { style: { display: 'grid', gap: 24, padding: 24, width: 360 } },
        React.createElement('div', { 'data-box': 'surface' },
          React.createElement(Surface, { field: gradient, screen: 'stipple', h: 120, color: 'blue' })),
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
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 640 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(htmlPath).href);

// wait until all three canvases have painted ink (Image is async on its data-URI load)
let inks = [];
try {
  await page.waitForFunction(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (cs.length < 6) return false;
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

const pngPath = path.join(HERE, '.verify-react-visual.png');
await page.screenshot({ path: pngPath, fullPage: true });
await browser.close();

const label = ['Surface (gradient)', 'Text (HALFTONE UI)', 'Image (luminance)', 'Button (solid plate)', 'Meter (0.66 fill)', 'Card (whisper backdrop)'];
ok('six canvases mounted', inks.length === 6, `count=${inks.length}`);
inks.forEach((c, i) => ok(`${label[i] || 'canvas ' + i}: real ink drawn`, c.ink > 0, `${c.w}x${c.h}, inkPx=${c.ink}`));
ok('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\nscreenshot: ${pngPath}`);

fs.unlinkSync(htmlPath);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
