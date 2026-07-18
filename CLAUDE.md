# halftone-ui — operational notes

Terse and operational. If you're an agent or a new contributor, read this before touching
anything — several of these facts were learned the hard way, in multi-hour debugging sessions.

## Verification

Run from repo root:

```
npm run verify --prefix tools        # full suite, ~3min (includes golden)
npm run verify:quick --prefix tools  # skips the golden check, faster
```

Both wrap `tools/verify-all.mjs`, which runs the 8 suites below plus `golden:check` (full only):

| Script | Covers |
|---|---|
| `node tools/verify-core.mjs` | core lifecycle (rng, screens, color, fields, draw, context, press) |
| `node tools/verify-plates.mjs` | CMYK plate rendering |
| `node tools/verify-charts.mjs` | chart field contracts |
| `node tools/verify-react.mjs` | react adapter, jsdom |
| `node tools/verify-vue.mjs` | vue adapter, jsdom |
| `node tools/verify-react-visual.mjs` | react adapter, real pixel readback |
| `node tools/verify-vue-visual.mjs` | vue adapter, real pixel readback |
| `node tools/verify-studio.mjs` | Studio SPA end-to-end |

CI runs `npm run verify --prefix tools` (`.github/workflows/verify.yml`). Current suite counts:
charts 14, core 33, plates 8, react 40, vue 46, react-visual 19, vue-visual 19, studio 50.

Additional golden scripts (see below): `golden:write`, `golden:check`, `golden:selftest`, all
`--prefix tools`.

## Playwright rule

Every pixel-readback harness (`verify-react-visual`, `verify-vue-visual`, `verify-studio`) MUST
launch Chromium with `args: ['--disable-gpu']`. GPU-backed canvas readback is nondeterministically
blank in headless Chromium — same code path every time, but all canvases silently read back 0 ink.
Existing harnesses already set this; any new pixel-readback harness must too.

## Golden oracle

`tools/golden-frames.mjs` hashes 172 canvases x 2 themes in `dist/index.html`, byte-identically.
`dist/index.html` is a COMMITTED build artifact produced by `node tools/build-standalone.mjs` from
`docs/index.html`, and it INLINES `halftone-kit/core`. That means **any core edit requires a dist
rebuild + `golden:check`, even when `docs/` itself is untouched** — the golden oracle only sees
`dist/`, not source.

For intentional visual changes: rebuild dist, eyeball the result, then run `golden:write` to
re-baseline before committing.

## Layout & deploy

Static Vercel site. **Pushing to `main` IS the production deploy** (halftone-ui.com) — there is no
separate release step.

- `docs/index.html` — source of the docs engine (legacy single-file app)
- `dist/` — its built artifact (see Golden oracle above)
- `index.html` — landing page
- `studio/` — the Studio SPA; source lives in `studio/src`, built into a committed
  self-contained `studio/index.html` by `node tools/build-studio.mjs`
- `halftone-kit/` — the library: framework-free `core/`, plus copy-in `react/` and `vue/` adapters

**Never create a root `package.json`** — Vercel would switch the static deploy to a Node build.
`tools/` is the only npm root in the repo.

## Library rules

- Adapters are copy-in via `degit` (see `README.md`), not published to npm — there is no version,
  no package. Re-running the `degit` command is how a consumer picks up a later revision.
- Every component's canvas is purely decorative: `aria-hidden="true"` is placed AFTER prop/attr
  spreads so a caller cannot override it and accidentally expose the canvas to assistive tech.
  Real semantics live in real DOM (`<button>`, `<progress>`, `<table>`).
- `core/charts.js` is imported directly by the adapters (`react/chart.jsx`, `vue/chart.js`) and is
  deliberately NOT re-exported from `core/index.js` — this keeps chart code out of the docs bundle.
- Field contract: `field(u, v, p) -> tone 0..1`. `u, v` are normalized to `[0,1]`, with `v=0` at
  the TOP; `p` is the raw pixel point, an escape hatch for callers that need device coordinates.

## Gotchas

- Vue's `watch` is lazy (doesn't fire on mount) — never transplant a React "skip-the-first-effect"
  guard into a Vue `watch`; one such transplant ate the first prop change silently.
- React range inputs re-fire a synthetic `onChange` per input event during a drag. Commit undo
  history on the NATIVE `change` event instead, or a single scrub becomes many undo steps.
- Scene JSON import is untrusted: the sanitizer (`sanitizeScene` in `studio/src/presets.js`) clamps
  geometry AND press dials AND budgets the scene aggregate (frame count, total canvas area, and
  total generation work charged through core's `grainCost` estimator) — keep it that way. The
  reducer's `boundGeom` (`studio/src/store.js`) is the geometry choke point that every frame passes
  through before entering state, and the roll re-screens under the same work budget.
- core's `grainPts` (and the `grainCost` estimator that mirrors it) enforce a per-call work budget
  (`MAX_CELLS` in `halftone-kit/core/screens.js`) for every screen family. It never engages at sane
  size/pitch ratios — the goldens are pinned at those ratios — so if a golden check fails after
  touching screen generation, the likely cause is the budget engaging where it shouldn't.

## Maintenance

This file rots fastest at the Verification section — any PR adding a harness or npm script should
update this file in the same commit.
