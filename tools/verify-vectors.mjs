// Characterization vectors for the core's pure math (rng, screens, color) and the Studio
// reducer (store.js). These pin CURRENT shipped behavior — golden-frames.mjs depends on the
// same math but only catches drift (~3min, byte hashes); this harness catches wrong constants
// in under a second. Anyone intentionally changing core math must update BOTH this file and the
// golden baseline in the same commit — a vector-only failure is the early 1-second warning the
// golden gives in 3 minutes.

import { mulberry32, poisson } from '../halftone-kit/core/rng.js';
import { grainPts, amRadius } from '../halftone-kit/core/screens.js';
import { INKS, PAPER, mixHex, iband, tuneInk, tuneMix } from '../halftone-kit/core/color.js';
import { reducer, initialState } from '../studio/src/store.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

// ============================================================================================
// Step 1: RNG and screen vectors
// ============================================================================================

// characterization — pins the shipped mulberry32(1859) sequence; golden frames depend on it.
const MULBERRY_1859_FIRST5 = [
  0.753632371780,
  0.552105945535,
  0.787890482694,
  0.703675117809,
  0.566031032009,
];
{
  const r = mulberry32(1859);
  const got = Array.from({ length: 5 }, () => r());
  ok('mulberry32(1859) first 5 values pinned to 12dp', got.every((v, i) => v.toFixed(12) === MULBERRY_1859_FIRST5[i].toFixed(12)),
    JSON.stringify(got.map((v) => v.toFixed(12))));
}

{
  const seqA = Array.from({ length: 5 }, mulberry32(1859));
  const seqB = Array.from({ length: 5 }, mulberry32(1859));
  ok('mulberry32(1859) is deterministic across instances', JSON.stringify(seqA) === JSON.stringify(seqB));
}

// characterization — poisson(100,100,5, mulberry32(7)) observed point count.
const POISSON_7_COUNT = 264;
{
  const p1 = poisson(100, 100, 5, mulberry32(7));
  const p2 = poisson(100, 100, 5, mulberry32(7));
  ok('poisson(100,100,5,mulberry32(7)) deterministic point count', p1.length === p2.length && p1.length === POISSON_7_COUNT,
    `p1=${p1.length} p2=${p2.length}`);
  ok('poisson first-3 points identical across runs',
    JSON.stringify(p1.slice(0, 3)) === JSON.stringify(p2.slice(0, 3)));
  ok('poisson points all within [0,100] bounds', p1.every((p) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100));
}

// grainPts pitch floors: at r <= ~1.29 (am) / r <= ~1.27 (lines) the absolute floor (4.4 / 2.8)
// dominates over r*3.4 / r*2.2, so point counts at r=0.1 and r=1.0 must be identical.
{
  const amLowR = grainPts(50, 50, 0.1, mulberry32(1), 'am');
  const amFloorR = grainPts(50, 50, 1.0, mulberry32(1), 'am');
  ok('am screen: pitch floor (4.4) dominates for r in [0.1, 1.0]', amLowR.length === amFloorR.length && amLowR.length === 181,
    `r=0.1: ${amLowR.length}, r=1.0: ${amFloorR.length}`);

  const hatchLowR = grainPts(50, 50, 0.1, mulberry32(1), 'hatch');
  const hatchFloorR = grainPts(50, 50, 1.0, mulberry32(1), 'hatch');
  ok('hatch screen: pitch floor (2.8) dominates for r in [0.1, 1.0]', hatchLowR.length === hatchFloorR.length && hatchLowR.length === 1938,
    `r=0.1: ${hatchLowR.length}, r=1.0: ${hatchFloorR.length}`);
}

// amRadius: area law r = base * sqrt(tone) * wobble — monotonic in tone.
{
  const r0 = amRadius(3, 0), rHalf = amRadius(3, 0.5), r1 = amRadius(3, 1);
  ok('amRadius(3,0) pinned to 0', r0 === 0);
  ok('amRadius(3,1) pinned to 3', r1 === 3);
  ok('amRadius(3,0.5) pinned', rHalf.toFixed(12) === (2.121320343559643).toFixed(12));
  ok('amRadius is monotonic in tone: amRadius(3,0) < amRadius(3,0.5) < amRadius(3,1)', r0 < rHalf && rHalf < r1);
}

// ============================================================================================
// Step 2: color vectors
// ============================================================================================

{
  const mixed = mixHex(INKS.blue, INKS.orange);
  ok('mixHex(blue, orange) pinned', mixed === '#322a23', mixed);
  // Identity does NOT hold: mixHex is a multiplicative channel mix (round(s*s/255)), which
  // darkens any non-extreme channel when mixed with itself. Pin the observed value — not a bug.
  const selfMixed = mixHex(INKS.blue, INKS.blue);
  ok('mixHex(blue, blue) self-mix pinned (identity does NOT hold — multiplicative darkening)',
    selfMixed === '#0f2385', selfMixed);
}

{
  const inBand = iband(0.5, 0, 1);
  const belowBand = iband(-1, 0, 1);
  const aboveBand = iband(2, 0, 1);
  ok('iband(0.5, 0, 1) in-band smoothstep pinned to 0.5', inBand === 0.5, String(inBand));
  ok('iband(-1, 0, 1) out-of-band clamps to 0', belowBand === 0, String(belowBand));
  ok('iband(2, 0, 1) out-of-band clamps to 1', aboveBand === 1, String(aboveBand));
}

{
  const tunedBlue = tuneInk(INKS.blue);
  ok('tuneInk(blue) pinned', tunedBlue === '#3d5fb8', tunedBlue);
  const tunedBlack = tuneInk(INKS.black);
  ok('tuneInk(black) passes through unchanged (low saturation, s < 0.18)', tunedBlack === INKS.black, tunedBlack);
}

{
  const tunedMix = tuneMix(INKS.blue, INKS.orange);
  ok('tuneMix(blue, orange) pinned', tunedMix === '#56412e', tunedMix);
}

{
  ok('PAPER.light pinned to #EDE9DE', PAPER.light === '#EDE9DE', PAPER.light);
  ok('PAPER.dark pinned to #141519', PAPER.dark === '#141519', PAPER.dark);
}

// ============================================================================================
// Step 3: Studio reducer vectors
// ============================================================================================

const frame = (id) => ({
  id, type: 'x', name: 'f', x: 0, y: 0, w: 200, h: 100, visible: true,
  props: { screen: 'stipple', r: 2.5, roll: 0, seed: 1 },
});

// add -> undo -> redo
{
  let s = initialState();
  s = reducer(s, { type: 'add', frame: frame('a') });
  ok('add: frames length 1, selectedId set', s.frames.length === 1 && s.selectedId === 'a');
  s = reducer(s, { type: 'undo' });
  ok('undo after add: frames length 0', s.frames.length === 0);
  s = reducer(s, { type: 'redo' });
  ok('redo after undo: frames length 1', s.frames.length === 1);
}

// begin -> transient x3 -> commit -> exactly one history entry
{
  let s = initialState();
  s = reducer(s, { type: 'add', frame: frame('a') });
  const pastAfterAdd = s.past.length;
  s = reducer(s, { type: 'begin' });
  s = reducer(s, { type: 'transient', id: 'a', frame: { x: 1 } });
  s = reducer(s, { type: 'transient', id: 'a', frame: { x: 2 } });
  s = reducer(s, { type: 'transient', id: 'a', frame: { x: 3 } });
  ok('mid-gesture: no history entry pushed by transient', s.past.length === pastAfterAdd);
  s = reducer(s, { type: 'commit' });
  ok('commit: exactly one history entry for the whole gesture', s.past.length === pastAfterAdd + 1);
  s = reducer(s, { type: 'undo' });
  ok('undo once restores pre-gesture state (x back to 0)', s.frames[0].x === 0);
}

// double-begin: still one pending snapshot
{
  let s = initialState();
  s = reducer(s, { type: 'add', frame: frame('a') });
  s = reducer(s, { type: 'begin' });
  const pendingAfterFirst = s.pending;
  s = reducer(s, { type: 'begin' });
  ok('double-begin: pending snapshot unchanged (same reference)', s.pending === pendingAfterFirst);
}

// remove of the selected frame clears selection
{
  let s = initialState();
  s = reducer(s, { type: 'add', frame: frame('a') });
  s = reducer(s, { type: 'remove', id: 'a' });
  ok('remove of selected frame: selection cleared', s.selectedId === null && s.frames.length === 0);
}

// redo stack invalidation
{
  let s = initialState();
  s = reducer(s, { type: 'add', frame: frame('a') });
  s = reducer(s, { type: 'add', frame: frame('b') });
  s = reducer(s, { type: 'undo' });
  ok('undo: future populated', s.future.length === 1);
  s = reducer(s, { type: 'add', frame: frame('c') });
  ok('new action after undo: future invalidated', s.future.length === 0);
  const framesLenBeforeRedo = s.frames.length;
  s = reducer(s, { type: 'redo' });
  ok('redo after invalidation is a no-op', s.frames.length === framesLenBeforeRedo);
}

// HISTORY_MAX cap (64)
{
  let s = initialState();
  s = reducer(s, { type: 'add', frame: frame('a') });
  for (let i = 0; i < 74; i++) s = reducer(s, { type: 'rename', id: 'a', name: `n${i}` });
  ok('past length capped at HISTORY_MAX (64) after 75 undoable actions', s.past.length === 64, `past.length=${s.past.length}`);
}

// roll (single frame): invariants only — roll is random by design
{
  let s = initialState();
  s = reducer(s, { type: 'add', frame: frame('a') });
  const before = s.frames[0];
  s = reducer(s, { type: 'roll', id: 'a' });
  const after = s.frames[0];
  ok('roll: screen differs from previous', before.props.screen !== after.props.screen,
    `${before.props.screen} -> ${after.props.screen}`);
  ok('roll: roll value differs from previous', before.props.roll !== after.props.roll);
  ok('roll: geometry unchanged', before.x === after.x && before.y === after.y && before.w === after.w && before.h === after.h);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
