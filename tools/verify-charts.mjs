// Pure unit check for the framework-free chart field builders (halftone-kit/core/charts.js). These
// are just math — no canvas, no DOM — so they test in plain Node with no browser. The adapter's
// lifecycle (verify-react.mjs) and real pixels (verify-react-visual.mjs) cover the React side; this
// pins the geometry: baseline-anchored fills, inter-bar gutters, slot-centered interpolation.
//
// Run: node tools/verify-charts.mjs

import { barsField, areaField, lineField } from '../halftone-kit/core/charts.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

// ---- barsField: one bar per value, baseline-anchored, gutters between --------------------------
{
  const f = barsField([1, 0], { gap: 0.2 }); // bar 0 full height, bar 1 empty
  ok('bars: a full-height bar inks from baseline to top (center column, mid height)', f(0.25, 0.5) === 1, `f(0.25,0.5)=${f(0.25, 0.5)}`);
  ok('bars: a full-height bar inks near the top too', f(0.25, 0.05) === 1, `f(0.25,0.05)=${f(0.25, 0.05)}`);
  ok('bars: a zero-height bar draws no ink', f(0.75, 0.5) === 0 && f(0.75, 0.99) === 0, `f(0.75,·)=${f(0.75, 0.5)},${f(0.75, 0.99)}`);
  ok('bars: the inter-bar gutter is blank (f < gap/2)', f(0.01, 0.9) === 0, `f(0.01,0.9)=${f(0.01, 0.9)}`);
  ok('bars: out-of-range u is blank', f(-0.1, 0.9) === 0 && f(1.2, 0.9) === 0);
}
{
  const f = barsField([5], { max: 10 }); // half-height bar via explicit max
  ok('bars: explicit max scales height (5/10 -> fills only the bottom half)', f(0.5, 0.4) === 0 && f(0.5, 0.6) === 1, `top=${f(0.5, 0.4)} bottom=${f(0.5, 0.6)}`);
}
ok('bars: empty data is the zero field', barsField([])(0.5, 0.5) === 0);

// ---- areaField: filled region under a slot-centered polyline ------------------------------------
{
  const f = areaField([0, 1]); // ramps from 0 at the left center to 1 at the right center
  ok('area: fill follows the interpolated height (midpoint ~half)', f(0.5, 0.6) === 1 && f(0.5, 0.4) === 0, `above=${f(0.5, 0.6)} below=${f(0.5, 0.4)}`);
  ok('area: the low end sits on the baseline (almost no fill)', f(0.25, 0.9) === 0, `f(0.25,0.9)=${f(0.25, 0.9)}`);
  ok('area: the high end fills nearly full height', f(0.75, 0.1) === 1, `f(0.75,0.1)=${f(0.75, 0.1)}`);
}

// ---- lineField: a soft-edged stroked band around the polyline -----------------------------------
{
  const f = lineField([0.5, 0.5], { stroke: 0.05, max: 1 }); // flat line at height 0.5 -> down-pos 0.5
  ok('line: the band is darkest on the line center', f(0.5, 0.5) === 1, `center=${f(0.5, 0.5)}`);
  ok('line: tone feathers inside the band (0<tone<1, and lighter than the center)', f(0.5, 0.53) > 0 && f(0.5, 0.53) < 1 && f(0.5, 0.53) < f(0.5, 0.5), `mid=${f(0.5, 0.53)}`);
  ok('line: nothing outside the stroke band', f(0.5, 0.7) === 0, `far=${f(0.5, 0.7)}`);
}
ok('line: empty data is the zero field', lineField([])(0.5, 0.5) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
