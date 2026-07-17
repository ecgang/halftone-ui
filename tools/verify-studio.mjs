// End-to-end check for the Studio (studio/index.html). Builds the committed artifact, then drives
// it in real headless Chromium (--disable-gpu: GPU canvas readback is nondeterministically blank)
// through the core loop: add -> ink -> select -> re-dial -> roll -> duplicate -> undo -> export.
//
// Run: node tools/verify-studio.mjs   (writes tools/.verify-studio.png)

import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

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

// ---- the two real download paths ----------------------------------------------------------------
await page.click('[data-frame]'); // proof needs a selection
const proofDl = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
await page.click('#export-proof');
const proof = await proofDl;
ok('Proof (PNG) downloads the selected frame', !!proof && /^proof-.*\.png$/.test(proof.suggestedFilename()), proof?.suggestedFilename() || '(none)');
const dataDl = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
await page.click('#export-data');
const data = await dataDl;
ok('Data (JSON) downloads studio-scene.json', !!data && data.suggestedFilename() === 'studio-scene.json', data?.suggestedFilename() || '(none)');

const png = path.join(HERE, '.verify-studio.png');
await page.screenshot({ path: png, fullPage: true });
await browser.close();

ok('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\nscreenshot: ${png}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
