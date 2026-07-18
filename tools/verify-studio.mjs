// End-to-end check for the Studio (studio/index.html). Builds the committed artifact, then drives
// it in real headless Chromium (--disable-gpu: GPU canvas readback is nondeterministically blank)
// through the core loop: add -> ink -> select -> re-dial -> roll -> duplicate -> undo -> export.
//
// Run: node tools/verify-studio.mjs   (writes tools/.verify-studio.png)

import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

// ---- build the artifact first: the test target IS the committed file ----------------------------
execFileSync(process.execPath, [path.join(HERE, 'build-studio.mjs')], { stdio: 'inherit' });

const browser = await chromium.launch({ args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(path.join(ROOT, 'studio', 'index.html')).href);

await page.waitForSelector('[data-add="barchart"]');
ok('page loads with the type case', true);
ok('empty state shows on a bare stone', await page.locator('[data-empty]').count() === 1);

// A pixel signature of the selected frame's first canvas — sampled sum+count, cheap but sensitive
// to any real re-press (geometry, screen, or ink change).
const sig = () => page.evaluate(() => {
  const cv = document.querySelector('[data-frame] canvas');
  if (!cv || !cv.width) return null;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0, sum = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 10) { ink++; sum += i; }
  return `${ink}:${sum}`;
});
const inkCount = () => page.evaluate(() => {
  const cv = document.querySelector('[data-frame] canvas');
  if (!cv || !cv.width) return -1;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 10) ink++;
  return ink;
});

// ---- add a BarChart -----------------------------------------------------------------------------
await page.click('[data-add="barchart"]');
ok('add: exactly one frame on the stone', await page.locator('[data-frame]').count() === 1);
await page.waitForFunction(() => {
  const cv = document.querySelector('[data-frame] canvas');
  if (!cv || !cv.width) return false;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 10) return true;
  return false;
}, { timeout: 5000 }).catch(() => {});
ok('add: the BarChart canvas carries ink', (await inkCount()) > 0, `inkPx=${await inkCount()}`);

// ---- select -> inspector binds ------------------------------------------------------------------
await page.keyboard.press('Escape'); // add auto-selects; drop it so the click itself proves selection
ok('escape deselects (X input gone)', await page.locator('#insp-x').count() === 0);
await page.click('[data-frame]');
ok('click selects: inspector shows X/Y inputs', await page.locator('#insp-x').count() === 1 && await page.locator('#insp-y').count() === 1);

// let the press-in entrance settle before pixel comparisons (it ramps ink over ~700ms)
await page.waitForTimeout(1600);

// ---- change a dial: screen -> lines -------------------------------------------------------------
const before = await sig();
await page.selectOption('#insp-screen', 'lines');
await page.waitForTimeout(400);
const afterScreen = await sig();
ok('dial change (screen -> lines) re-presses the canvas', before !== null && afterScreen !== before, `${before} -> ${afterScreen}`);

// ---- Roll a press -------------------------------------------------------------------------------
await page.click('#roll-press');
await page.waitForTimeout(400);
const afterRoll = await sig();
ok('Roll a press re-presses the canvas again', afterRoll !== afterScreen, `${afterScreen} -> ${afterRoll}`);

// ---- duplicate / undo / redo --------------------------------------------------------------------
await page.keyboard.press('Control+d');
ok('cmd/ctrl+D duplicates -> 2 frames', await page.locator('[data-frame]').count() === 2);
await page.keyboard.press('Control+z');
ok('undo -> 1 frame', await page.locator('[data-frame]').count() === 1);
await page.keyboard.press('Control+Shift+z');
ok('redo -> 2 frames', await page.locator('[data-frame]').count() === 2);
await page.keyboard.press('Control+z');
ok('undo again -> 1 frame', await page.locator('[data-frame]').count() === 1);

// ---- layers panel mirrors the stone -------------------------------------------------------------
ok('layers: one row per frame', await page.locator('[data-layer]').count() === 1);

// ---- code export --------------------------------------------------------------------------------
await page.click('#export-code');
const code = await page.locator('[data-modal-text]').inputValue();
ok('code export modal contains <BarChart', code.includes('<BarChart'), code.split('\n').find((l) => l.includes('<BarChart')) || '(missing)');
ok('code export imports the adapter', code.includes('HalftoneProvider'));
await page.keyboard.press('Escape');
ok('escape closes the modal', await page.locator('[data-modal-text]').count() === 0);

// ---- undoable geometry edit through the inspector -----------------------------------------------
await page.click('[data-frame]');
await page.fill('#insp-x', '40');
await page.keyboard.press('Enter');
const movedX = await page.evaluate(() => document.querySelector('[data-frame]').style.left);
ok('inspector X edit moves the frame', movedX === '40px', `left=${movedX}`);

// ---- a slider scrub is ONE undo step ------------------------------------------------------------
// (React's synthetic onChange fires per input event on range sliders; the commit must listen to the
// NATIVE change event or every pointermove becomes its own history entry.)
const scaleEm = () => page.locator('label:has(#insp-scale) em').textContent();
const scale0 = await scaleEm();
const sb = await page.locator('#insp-scale').boundingBox();
await page.mouse.move(sb.x + sb.width * 0.2, sb.y + sb.height / 2);
await page.mouse.down();
for (let i = 3; i <= 9; i++) await page.mouse.move(sb.x + sb.width * i / 10, sb.y + sb.height / 2);
await page.mouse.up();
ok('scale dial scrub changes the value', (await scaleEm()) !== scale0, `${scale0} -> ${await scaleEm()}`);
await page.keyboard.press('Escape'); // blur the slider so undo reaches the app, selection kept
await page.keyboard.press('Control+z');
ok('slider scrub costs ONE undo step', (await scaleEm()) === scale0, `after 1 undo: ${await scaleEm()} (want ${scale0})`);

// ---- every sort presses ink inside the studio ---------------------------------------------------
for (const t of ['surface', 'text', 'image', 'button', 'meter', 'card', 'linechart']) {
  await page.click(`[data-add="${t}"]`);
}
ok('type case: all 8 sorts on the stone', await page.locator('[data-frame]').count() === 8);
const allInked = await page.waitForFunction(() => {
  const frames = [...document.querySelectorAll('[data-frame]')];
  return frames.length === 8 && frames.every((f) => {
    const cv = f.querySelector('canvas');
    if (!cv || !cv.width) return false;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) return true;
    return false;
  });
}, { timeout: 8000 }).then(() => true).catch(() => false);
ok('every sort carries ink (Surface/Text/Image/Button/Meter/Card/both charts)', allInked);

// ---- drag moves a frame; undo restores it -------------------------------------------------------
const dragTarget = page.locator('[data-frame]').first();
const beforeLeft = await dragTarget.evaluate((el) => el.style.left);
const box = await dragTarget.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
await page.mouse.up();
const afterLeft = await dragTarget.evaluate((el) => el.style.left);
ok('drag moves the frame (+60px)', afterLeft === `${parseInt(beforeLeft, 10) + 60}px`, `${beforeLeft} -> ${afterLeft}`);
await page.keyboard.press('Control+z');
ok('drag is one undo step (position restored)', await dragTarget.evaluate((el) => el.style.left) === beforeLeft);

// ---- eye toggle hides / shows -------------------------------------------------------------------
await page.locator('[data-layer] .eye').first().click();
ok('eye toggle hides the frame', await page.locator('[data-frame]').count() === 7);
await page.locator('[data-layer] .eye').first().click();
ok('eye toggle shows it again', await page.locator('[data-frame]').count() === 8);

// ---- clicking a layer row's NAME selects the frame ----------------------------------------------
// (the name input spans most of the row; it must not swallow the row's select)
await page.keyboard.press('Escape');
await page.locator('[data-layer] input.name').first().click();
const layerSel = await page.evaluate(() => {
  const r = document.querySelector('[data-layer].selected');
  const f = document.querySelector('[data-frame].selected');
  return !!r && !!f && r.dataset.layer === f.dataset.frame;
});
ok('layer name click selects the frame (row + frame highlight)', layerSel === true);
await page.keyboard.press('Escape'); // blur the name field again

// ---- replay re-presses without errors -----------------------------------------------------------
await page.click('#replay');
await page.waitForTimeout(1400); // let the press-in ramp settle
const replayInk = await inkCount();
ok('replay: ink settles back in', replayInk > 0, `inkPx=${replayInk}`);

// ---- theme toggle swaps the chrome and keeps the ink --------------------------------------------
await page.click('#theme-toggle');
ok('theme toggle -> light chrome', await page.evaluate(() => document.documentElement.dataset.mode) === 'light');
await page.waitForTimeout(300);
ok('light mode: canvases still ink', (await inkCount()) > 0);
await page.click('#theme-toggle');
ok('theme toggle -> back to dark', await page.evaluate(() => document.documentElement.dataset.mode) === 'dark');
await page.waitForTimeout(300);

// ---- the two real download paths (validate CONTENT, not just filenames) -------------------------
await page.click('[data-frame]'); // proof needs a selection
const proofDl = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
await page.click('#export-proof');
const proof = await proofDl;
const proofBytes = proof ? fs.readFileSync(await proof.path()) : Buffer.alloc(0);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
ok('Proof (PNG) downloads a REAL png (magic bytes, non-trivial size)',
  !!proof && /^proof-.*\.png$/.test(proof.suggestedFilename()) && proofBytes.subarray(0, 8).equals(PNG_MAGIC) && proofBytes.length > 500,
  proof ? `${proof.suggestedFilename()} ${proofBytes.length}b` : '(none)');
const dataDl = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
await page.click('#export-data');
const data = await dataDl;
let scene = null;
try { scene = data ? JSON.parse(fs.readFileSync(await data.path(), 'utf8')) : null; } catch (e) { /* fails below */ }
const liveFrames = await page.locator('[data-frame]').count();
const sceneFrames = scene && (Array.isArray(scene) ? scene : scene.frames);
ok('Data (JSON) downloads VALID json whose frame count matches the stone',
  !!data && data.suggestedFilename() === 'studio-scene.json' && Array.isArray(sceneFrames) && sceneFrames.length === liveFrames,
  `frames=${sceneFrames ? sceneFrames.length : 'unparseable'} live=${liveFrames}`);

// ---- hostile text cannot break or hijack the JSX export -----------------------------------------
// Labels/headings are user-edited and survive scene import; the generator must keep them inert.
// Braces would parse as expressions, a lone quote kills a JSX attribute (no backslash escapes),
// and </Button><script> would escape the element entirely if interpolated raw.
const HOSTILE = `pwn" {evil}</Button><script>alert(1)</script> \\ 'q`;
await page.click('[data-add="button"]');
await page.click('[data-frame].selected canvas').catch(() => {});
await page.fill('#insp-label', HOSTILE);
await page.keyboard.press('Enter');
await page.click('#export-code');
const hostileCode = await page.locator('[data-modal-text]').inputValue();
await page.keyboard.press('Escape');
ok('hostile label rides inside an expression container, not raw children',
  /<Button [^>]*>\{"/.test(hostileCode), (hostileCode.match(/<Button [^>]*>.{0,25}/) || ['(no Button)'])[0]);
let parseErr = null;
try { await esbuild.transform(hostileCode, { loader: 'jsx' }); } catch (e) { parseErr = e.errors?.[0]?.text || String(e); }
ok('generated JSX with hostile label still PARSES (esbuild jsx)', parseErr === null, parseErr || 'parsed clean');

// ---- hostile scene import cannot exhaust the canvas ---------------------------------------------
// sanitizeScene bounds BOTH ends of x/y/w/h: a 1e9-px frame would make the press allocate an
// enormous backing store (tab freeze / null 2d context), so extreme imports must land clamped.
const hostileScene = JSON.stringify({ frames: [
  { type: 'barchart', x: 1e15, y: -1e15, w: 1e9, h: 1e9, props: { data: [4, 9, 6] } },
  { type: 'button', x: 0, y: 0, w: -50, h: 1, props: { label: 'tiny' } },
  // The dial attack: r=0.0005 would have poisson() allocate a ~terabyte grid; scale<0 flips the
  // pitch sign into Int32Array(Infinity). Both must land clamped to the inspector's UI ranges.
  { type: 'surface', x: 0, y: 0, w: 200, h: 120, props: { r: 0.0005, scale: -5, ink: 99, fieldName: 'gradient' } },
  // A megabyte text prop must be capped before it reaches the rasterizer.
  { type: 'text', x: 0, y: 200, w: 200, h: 60, props: { text: 'A'.repeat(1_000_000) } },
] });
await page.setInputFiles('input[type="file"]', { name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(hostileScene) });
await page.waitForTimeout(600);
const bounds = await page.evaluate(() => [...document.querySelectorAll('[data-frame]')].map((el) => ({
  x: Math.abs(parseInt(el.style.left, 10)), y: Math.abs(parseInt(el.style.top, 10)),
  w: parseInt(el.style.width, 10), h: parseInt(el.style.height, 10),
})));
ok('hostile import: every frame lands within the sanitizer ceilings (w/h in [40,4096], |x|,|y| <= 100000)',
  bounds.length === 4 && bounds.every((b) => b.w >= 40 && b.w <= 4096 && b.h >= 40 && b.h <= 4096 && b.x <= 100000 && b.y <= 100000),
  JSON.stringify(bounds));
// Select the surface frame and read the pitch dial back — the r=0.0005 / scale=-5 attack must have
// been clamped to the inspector's own ranges (r >= 1, scale >= 0.4), or poisson() would have frozen
// the tab before we ever got here.
await page.locator('[data-frame]').nth(2).click();
const rVal = parseFloat(await page.locator('#insp-r').inputValue());
const scaleVal = parseFloat(await page.locator('#insp-scale').inputValue());
ok('hostile import: pitch dials clamped to UI ranges (r in [1,6], scale in [0.4,2.4])',
  rVal >= 1 && rVal <= 6 && scaleVal >= 0.4 && scaleVal <= 2.4, `r=${rVal} scale=${scaleVal}`);
// The same allocator bomb through the FRONT door: a user typing 1e9 into the inspector's W field
// must be clamped by the reducer (GEOM.MAX_DIM), never committed to the live frame — the canvas
// backing store + Poisson grid would otherwise freeze the tab exactly like the hostile import.
await page.fill('#insp-w', '1000000000');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const wAfter = await page.evaluate(() => parseInt(document.querySelector('[data-frame].selected')?.style.width || '0', 10));
ok('inspector attack: an oversized typed W commits clamped (<= 4096), studio stays alive',
  wAfter >= 40 && wAfter <= 4096 && errors.length === 0, `w=${wAfter}`);
await page.click('#zoom-fit').catch(() => {}); // bring the clamped frames into view if possible
await page.waitForTimeout(400);
ok('hostile import: the studio stays alive and responsive (no page errors, frames present)',
  (await page.locator('[data-frame]').count()) === 4 && errors.length === 0, errors.slice(-2).join(' | ') || 'clean');

const png = path.join(HERE, '.verify-studio.png');
await page.screenshot({ path: png, fullPage: true });
await browser.close();

ok('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\nscreenshot: ${png}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
