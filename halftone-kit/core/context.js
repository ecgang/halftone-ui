// createPressContext — the per-instance state container that kills blocker 2 (global mutable
// singletons) and, with the lazy color getters below, blocker 4 (SSR) and the theming/harmony
// regressions V-11/V-12 guard against.
//
// The docs engine held its render dials, seed, palette, theme, plate inks, decorrelation counter
// and live-surface registry as MODULE GLOBALS (GRAIN :3007, state :3107, PAL :3110, INKS :3657,
// THEME :4703, seedTick :3115, registry :3116). Two instances on one page could not hold different
// settings — the second silently overwrote the first. Here every one of those is instance state on
// the returned context, and mount() takes the context it belongs to.
//
// SSR (V-3): this module touches no window/document/matchMedia/localStorage at import or at
// construction. `reduced` is a plain flag the adapter sets from matchMedia AT MOUNT (browser only);
// it defaults false, which is the correct SSR/no-preference resting behavior.
//
// COLOR IS LAZY AND CLOSES OVER THIS CONTEXT (V-11 — the single most dangerous line in the
// extraction). Getters below reference the instance-scoped `inks`/`pal`/`theme`, never a module
// binding. A getter closing over a module-scope PAL populated at import from matchMedia breaks SSR,
// per-instance theming and lazy color all at once — so it is structurally impossible here.

import { INKS, PAPER, tuneInk, tuneMix } from './color.js';

// The canonical resting-geometry base. Point positions (resting geometry) derive from this, NOT
// from `seed` — so the resting frame is seed-invariant in v1 and the golden stays O(configs), not
// O(configs x seeds) (§7). `seed` drives the ENTRANCE transient only; per-instance resting jitter
// is the opt-in `roll` offset (default 0 -> canonical geometry -> byte-identical to docs).
export const RESTING_BASE = 1859;

export function createPressContext(opts = {}) {
  // instance-scoped state — the former globals, one copy per context
  const grain = { pattern: 'hatch', scale: 1, ink: 1, wash: 1, ...(opts.grain || {}) };
  const theme = { mode: opts.mode || 'dark', hue: opts.hue || 0 };
  const inks = { ...INKS, ...(opts.inks || {}) };     // plate colors (the masthead/press vocabulary)
  const paper = { ...PAPER, ...(opts.paper || {}) };  // ground per mode
  const pal = { ...(opts.pal || {}) };                // semantic named colors; the adapter fills these from CSS vars
  const reg = new Set();                              // live surfaces (per-context registry, V-2)
  let seedTick = 0;                                   // decorrelation counter
  let roll = opts.roll || 0;                          // page-wide resting-geometry entropy (see below)

  const ctx = {
    // ---- resting-geometry seed base + the entrance seed ----
    base: RESTING_BASE,
    get seed() { return opts.seed ?? RESTING_BASE; }, // entrance transient seed
    // Shared resting-geometry seed: `base + roll` (§7). Surfaces read `seedValue + off` for their
    // point geometry, so bumping `roll` re-presses every surface on this context with fresh geometry
    // while the entrance seed and the roll-0 byte-identical invariant both hold. This is the
    // context-level analogue of the per-press `roll` opt — a provider default all its surfaces
    // share, which is exactly what a single page's "roll a press" reseed needs.
    get roll() { return roll; },
    get seedValue() { return RESTING_BASE + roll; },
    setRoll(r) { roll = r; return ctx; },
    grain,
    theme,
    // reduced-motion: a flag, not a matchMedia read (SSR-safe). Adapter sets it at mount.
    reduced: !!opts.reduced,

    // ---- decorrelation: mount() bumps this so co-located surfaces don't share a point grid ----
    nextOff() { return (seedTick += 313); },

    // ---- color, LAZY, closing over THIS context's inks/pal/theme (V-11) ----
    ink(name) { return inks[name]; },                 // raw plate color by name
    paper() { return paper[theme.mode]; },            // ground for the current mode
    // The default FOREGROUND ink — the contrast to paper(). A press with no explicit color inks
    // with this, so a plain <Surface> is visible without the caller naming a color. The docs drove
    // this off the `--ink` CSS var (:3012), light on a dark ground and dark on paper; the adapter
    // overrides it via setPal('fore', <--ink>). The fallback here reproduces that swing (white on
    // dark, near-black on light) so the core is usable even before any CSS is wired.
    fore() { return pal.fore ?? (theme.mode === 'dark' ? inks.white : inks.black); },
    palette(name) { return name == null ? { ...pal } : pal[name]; },
    setInk(name, hex) { inks[name] = hex; return ctx; },
    setPal(name, hex) { pal[name] = hex; return ctx; },

    // ---- harmony, PER-INSTANCE (V-12): reads ONLY this context's own inks ----
    // tuneInk/tuneMix run at DRAW time on resolved colors (the lazy-color rule) and never reach
    // across instances — a scoped case of V-9. Black/white pass through unchanged (tuneInk guards
    // low chroma), matching BASE_INKS handling in the docs (:4717-4718).
    tunedInk(name) { return tuneInk(inks[name]); },
    tunedMix(a, b) { return tuneMix(inks[a], inks[b]); },

    // ---- theme ----
    setTheme(patch) { Object.assign(theme, patch); return ctx; },

    // ---- registry (V-2): mount adds, destroy removes; size is the leak sensor ----
    _add(s) { reg.add(s); },
    _remove(s) { reg.delete(s); },
    get size() { return reg.size; },
    // A read-only snapshot of the live surfaces, for callers that need to iterate/filter (the docs
    // repaints on theme/dial/resize with per-surface variations repaint() can't express). Insertion
    // order is preserved (Set semantics), matching the old registry array.
    get surfaces() { return [...reg]; },
    // Repaint every live surface (theme change / dial change). A surface destroyed mid-repaint is
    // already out of `reg`, so this never touches a released handle (V-9).
    repaint() { reg.forEach((s) => { s.rebuild(); s.draw(); }); },
  };
  return ctx;
}
