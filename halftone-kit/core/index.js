// @halftone-ui/core — public surface. Framework-free, SSR-safe to import (nothing here touches
// window/document/localStorage at module scope; anything needing the DOM takes a factory).
//
// Build status: the pure primitive layer (rng, screens, color, fields) is in place. The single
// drawPress collapse (blocker 3 — 4 draw paths into 1), per-instance context, and the
// press()/mount()/resolvePress() lifecycle are the next phases. See plans/halftone-kit-extraction.md.

export { mulberry32, poisson, makeNoise } from './rng.js';
export { screenPts, amPts, grainPts, amDot } from './screens.js';
export { INKS, PAPER, mixHex, iband, tuneInk, tuneMix } from './color.js';
export { textField } from './fields.js';
