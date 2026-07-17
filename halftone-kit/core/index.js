// @halftone-ui/core — public surface. Framework-free, SSR-safe to import (nothing here touches
// window/document/localStorage at module scope; anything needing the DOM takes a factory).
//
// Build status: the pure primitive layer (rng, screens, color, fields), the single drawPress site
// (blocker 3 — single-plate collapse; multi-plate is the P2 golden-gated seam), the per-instance
// context (blocker 2), and the press()/mount()/resolvePress() lifecycle (blockers 1, 4, 5) are in
// place. P2 rebuilds the docs on this core under the golden. See plans/halftone-kit-extraction.md.

export { mulberry32, poisson, makeNoise } from './rng.js';
export { screenPts, amPts, grainPts, amDot } from './screens.js';
export { INKS, PAPER, mixHex, iband, tuneInk, tuneMix } from './color.js';
export { textField } from './fields.js';
export { drawPress, fieldSampler } from './draw.js';
export { createPressContext, RESTING_BASE } from './context.js';
export { press, resolvePress, mount } from './press.js';
