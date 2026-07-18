# Plan 004: Pin the core math and the Studio reducer with fast unit vectors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8072748..HEAD -- halftone-kit/core studio/src/store.js tools/verify-core.mjs`
> On drift in core/rng.js, core/color.js, core/screens.js, or store.js,
> re-read those files before pinning vectors — you pin CURRENT behavior.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (if plan 001 landed, add the new harness to
  `tools/verify-all.mjs`'s fast tier as a final step)
- **Category**: tests
- **Planned at**: commit `8072748`, 2026-07-17

## Why this matters

The core's pure math — the RNG sequence (`mulberry32`), blue-noise sampling
(`poisson`), screen-point generation (`grainPts` and its pitch floors), and the
color helpers (`mixHex`, `iband`, `tuneInk`, `tuneMix`) — has **zero direct
assertions**. It is exercised only transitively through pixel hashing
(`golden-frames.mjs`), which catches *drift* but not *correctness*: a wrong
constant that still renders "a" deterministic frame passes silently, and golden
runs ~3 minutes so nobody runs it per-edit. Likewise the Studio's undo/redo
reducer (`studio/src/store.js`) — the cheapest-to-test, highest-value logic in
the app — is covered only by a ~60s Playwright E2E. This plan adds one
sub-second Node harness pinning both.

## Current state

- `halftone-kit/core/rng.js` — `mulberry32(s)` (line 7, returns a () => float
  generator), `poisson(w, h, r, rng)` (line 17), `makeNoise(seed)` (line 53).
- `halftone-kit/core/screens.js` — `screenPts` (11), `amPts` (31), `grainPts`
  (46), `amRadius` (65). Note the pitch floors inside `grainPts`:
  `am` → `Math.max(4.4, r * 3.4)`, line families → `Math.max(2.8, r * 2.2)`;
  the `stipple` branch has NO floor (documented behavior — pin it as-is).
- `halftone-kit/core/color.js` — `INKS` (6), `PAPER` (10), `mixHex` (13),
  `iband` (22), `tuneInk` (54), `tuneMix` (62).
- `studio/src/store.js` — pure reducer with actions (from the source):
  `add, patch, remove, duplicate, rename, visible, reorder, roll, import,
  begin, transient, commit, select, camera, theme, replay` plus `undo`/`redo`
  (lines 99–111) and gesture coalescing via `pending` (85–93). It exports
  `newId` and `SCREENS` (imported by presets.js).
- Harness pattern to copy — `tools/verify-core.mjs` opening:

  ```js
  let pass = 0, fail = 0;
  const ok = (n, c, x = '') => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
  ```

  …ending with `console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);`
  Match this exactly — every harness in tools/ uses it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Run the new harness | `node tools/verify-vectors.mjs` | `N passed, 0 failed`, exit 0, < 2s |
| Prove no regression | `node tools/verify-core.mjs` | `24 passed, 0 failed` |
| Prove goldens hold | `npm run golden:check --prefix tools` | PASS (nothing in core changed) |

## Scope

**In scope**: `tools/verify-vectors.mjs` (create). If plan 001 landed:
one-line addition to `tools/verify-all.mjs`'s suite list.

**Out of scope**: ALL of `halftone-kit/` and `studio/` — this plan changes zero
production code. If a vector reveals a genuine bug, record it and STOP (fixing
core is a golden-cycle operation that needs its own review).

## Git workflow

- One commit. Imperative title + why-body. Do NOT push.

## Steps

### Step 1: Pin the RNG and screen vectors

In `tools/verify-vectors.mjs` (plain Node ESM, imports from
`../halftone-kit/core/index.js`):

- `mulberry32(1859)` — generate the first 5 values ONCE, inline them as
  constants with a comment: "characterization — pins the shipped sequence;
  golden frames depend on it". Assert each to 12 decimal places.
- `mulberry32(1859)` twice → identical sequences (determinism).
- `poisson(100, 100, 5, mulberry32(7))` — assert: deterministic (two runs give
  identical point counts and identical first-3 points), every point within
  bounds `0 <= x <= 100`, count within a recorded ±0 exact value (inline the
  observed count as a constant).
- `grainPts` floors: `grainPts(50, 50, 0.1, mulberry32(1), 'am')` and
  `('hatch')` must not hang and must produce pitch-floored geometry — assert
  point counts equal the counts you observe at pitch 4.4 / 2.8 respectively
  (i.e. equal to calling with a large-enough r that the floor dominates).
- `amRadius(3, 1)` and `amRadius(3, 0)` — inline observed values; assert
  monotonicity `amRadius(3, 0) < amRadius(3, 0.5) < amRadius(3, 1)`.

**Verify**: `node tools/verify-vectors.mjs` → all pass so far.

### Step 2: Pin the color vectors

- `mixHex(INKS-sampled hex pairs)` — pick two entries from `INKS`, inline the
  observed mix; assert `mixHex(a, a) === a` (identity) if that holds — if it
  does NOT hold, record the observed value as the pin and note it (do not
  "fix").
- `iband(...)` — one in-band and one out-of-band vector with inlined expected
  outputs.
- `tuneInk`/`tuneMix` — one vector each, inlined from observation.
- `PAPER.light === '#EDE9DE'`, `PAPER.dark === '#141519'` (constants pinned).

**Verify**: harness still exits 0.

### Step 3: Pin the Studio reducer

Import `{ reducer }` (or however store.js exports it — read the file; if the
reducer function is not exported, STOP: report that exporting it is a
one-line production change requiring approval). Drive synthetic sequences with
plain objects (no React needed):

- add → frames length 1, selectedId set; undo → length 0; redo → length 1.
- begin → transient ×3 → commit → exactly ONE history entry (undo once restores
  the pre-gesture state).
- begin → begin (double-begin) → still one pending snapshot.
- remove of the selected frame → selection cleared or moved (assert the
  observed behavior as the pin).
- redo stack invalidation: undo → new action → redo is a no-op.
- `HISTORY_MAX` cap: dispatch cap+10 discrete actions → past length never
  exceeds the cap (read the constant from the source).

**Verify**: `node tools/verify-vectors.mjs` → `N passed, 0 failed` with N ≥ 20.

### Step 4 (conditional): register in verify-all

Only if `tools/verify-all.mjs` exists: add `verify-vectors.mjs` right after
`verify-charts.mjs` in its suite list.

**Verify**: `npm run verify:quick --prefix tools` includes the new suite.

## Test plan

This plan IS tests. Structural pattern: `tools/verify-charts.mjs` (pure-Node
harness, same ok() idiom). Cases enumerated in Steps 1–3.

## Done criteria

- [ ] `node tools/verify-vectors.mjs` → ≥ 20 checks, 0 failed, < 2s wall
- [ ] `node tools/verify-core.mjs` still `24 passed, 0 failed`
- [ ] `npm run golden:check --prefix tools` still PASS
- [ ] `git status`: only the in-scope file(s)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `studio/src/store.js` imports React or DOM APIs (it shouldn't — report and
  propose the minimal export split instead of doing it).
- The reducer is not exported and exporting it would be your edit — STOP,
  report the one-liner for approval.
- Any vector exposes behavior that looks like a real bug (e.g. mixHex identity
  fails badly, floors don't hold) — pin nothing, report the finding.

## Maintenance notes

- These are characterization tests: they pin shipped behavior, and the golden
  frames depend on that same behavior. Anyone intentionally changing core math
  must update BOTH the vectors and the golden baseline in the same commit —
  a vector-only failure is the early, 1-second warning the golden gives in 3
  minutes.
