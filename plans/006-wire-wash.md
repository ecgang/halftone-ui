# Plan 006: The `wash` dial actually prints — a real tone multiplier through the kit draw path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8072748..HEAD -- halftone-kit/core/draw.js halftone-kit/core/press.js docs/index.html dist/index.html`
> On drift in draw.js or press.js, re-verify the excerpts below; the FP-identity
> argument in "Why this is golden-safe" must still hold. NOTE (reviewer,
> 2026-07-17): dist/index.html WILL show drift — it was rebuilt during the
> security-hardening rounds (screens.js work budgets). draw.js and press.js are
> untouched since the plan was written; only drift in THOSE two files is a
> reason to re-verify.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — this touches `halftone-kit/core`, which is inlined into the
  shipped `dist/index.html`; the golden byte-identity cycle is mandatory and
  the ONLY acceptable outcome is byte-identical (this change must be invisible
  at default settings).
- **Depends on**: none
- **Category**: tech-debt (API honesty)
- **Planned at**: commit `8072748`, 2026-07-17 (maintainer decision: WIRE it —
  chosen over "drop the prop" and "leave documented no-op")

## Why this matters

`wash` is a dangling dial. `resolvePress` resolves it into every spec
(`core/press.js:40` — `wash: opts.wash ?? g.wash`), all 14 adapter components
accept and forward a `wash` prop, and the docs site exposes a "washes" slider —
but the kit's draw path never consumes it: `mount().draw` passes only
`grain: { ink: spec.ink }` to `drawPress`. The maintainer confirmed the
confusion first-hand ("the washes slider really doesn't seem to do anything").
Decision: make it real. Semantics: `wash` is a second uniform tone multiplier
alongside `ink` — `ink` is the pressure of the component's ink, `wash` scales
the whole field's tone the way the docs' wash surfaces scale theirs
(`docs/index.html:3128` multiplies wash-field tone by `GRAIN.wash`). With both
defaulting to 1, every existing render is untouched.

## Why this is golden-safe (the load-bearing argument)

`dist/index.html` inlines core, and the docs engine calls `drawPress` — so a
careless core edit changes shipped pixels. The wiring below multiplies the
sampled tone by `(grain.wash ?? 1)`. The docs engine's draw calls do not pass
`wash` in their grain objects, so they hit the `?? 1` default, and IEEE-754
guarantees `v * 1 === v` exactly for every finite v. Therefore docs pixels are
bit-identical, and the golden must come back byte-identical — if it does not,
something else changed and you must STOP.

## Current state

- `halftone-kit/core/draw.js:55-64` — the one tone→radius site:

  ```js
  export function drawPress(ctx, { pts, W, H, field, screen, grain = {}, pr = 1, roll = 0, dot = null }) {
    const ink = grain.ink ?? 1;
    ...
      const v = sample(p.x / W, p.y / H, p) * ink;
  ```

- `halftone-kit/core/press.js:105-114` — `s.draw` passes
  `grain: { ink: spec.ink }` (no wash) into `drawPress`.
- `halftone-kit/core/press.js:33-58` — `resolvePress` already resolves
  `wash: opts.wash ?? g.wash` (context default `ctx.grain.wash`, itself 1).
- `drawPlates` (`draw.js:99`) is the AM/composite path — OUT of scope; wash
  applies to the mono `drawPress` path only in this plan.
- All 12 adapter component files already declare and forward `wash`
  (`grep -ln "wash" halftone-kit/react/*.jsx halftone-kit/vue/*.js` → 12 files);
  no adapter edits are needed.
- `halftone-kit/README.md` documents the press dials — it must gain one line
  for the now-live `wash`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rebuild dist | `node tools/build-standalone.mjs` | `wrote dist/index.html (...)` |
| Golden | `npm run golden:check --prefix tools` | **PASS — byte-identical** (mandatory) |
| Core suite | `node tools/verify-core.mjs` | `33 passed, 0 failed` (+ any you add) |
| Adapter suites | `node tools/verify-react.mjs` / `verify-vue.mjs` | 40 / 46 baseline + new |
| Pixels | `node tools/verify-react-visual.mjs` | 19 baseline + new |

## Scope

**In scope**:
- `halftone-kit/core/draw.js` (the two-line multiplier)
- `halftone-kit/core/press.js` (pass wash through in `s.draw`)
- `dist/index.html` (rebuilt artifact, committed with the core change)
- `halftone-kit/README.md` (one-line dial doc)
- `tools/verify-core.mjs`, `tools/verify-react-visual.mjs` (new checks)
- `CLAUDE.md` if it exists (delete the "wash is a no-op" gotcha line)

**Out of scope**:
- `drawPlates` / the AM composite path — wash on plates is a separate design
  question; do not touch.
- All adapter component files (they already forward wash).
- `docs/index.html` — the docs' own GRAIN.wash slider wiring stays as-is.
- Golden re-baselining — FORBIDDEN in this plan; byte-identical or STOP.

## Git workflow

- One commit containing core + dist + README + tests together (they must move
  atomically). Imperative title + why-body. Do NOT push.

## Steps

### Step 1: Wire the multiplier in core

In `draw.js` `drawPress`: `const ink = grain.ink ?? 1;` gains a sibling
`const wash = grain.wash ?? 1;` and the sample line becomes
`const v = sample(p.x / W, p.y / H, p) * ink * wash;`. Add a short comment:
wash is the field-tone dial (docs wash surfaces scale by it); default 1 keeps
every existing caller bit-identical.

In `press.js` `s.draw`: `grain: { ink: spec.ink }` →
`grain: { ink: spec.ink, wash: spec.wash }`.

**Verify**: `node tools/verify-core.mjs` → 33 passed (nothing asserted wash yet).

### Step 2: The golden gate

`node tools/build-standalone.mjs` then `npm run golden:check --prefix tools`.

**Verify**: `PASS — every canvas is byte-identical to the golden.` If ANY
canvas differs → STOP (see conditions).

### Step 3: Assert the dial in core and pixels

- `tools/verify-core.mjs`: add a check — mount two identical specs on stub
  canvases, one with `wash: 0.5`; assert the wash spec reaches `drawPress`
  (e.g. via `resolvePress(...).wash === 0.5`) AND, using the harness's existing
  recorded-2D-context pattern, that fewer/smaller marks ink at wash 0.5 than 1
  (fill/arc call count strictly lower for a mid-tone field).
- `tools/verify-react-visual.mjs`: add one Surface with `wash: 0.3` next to an
  identical `wash: 1` surface (same field/seed/size); assert inked-pixel count
  is strictly lower on the washed one (and > 0).

**Verify**: `node tools/verify-core.mjs` → 34+; `node tools/verify-react-visual.mjs`
→ 20+; `node tools/verify-vue.mjs` and `verify-react.mjs` still green.

### Step 4: Documentation

`halftone-kit/README.md` press-dials section: one line — `wash` scales the
field's tone before the screen thresholds it (0 = blank, 1 = as authored, >1
darkens); distinct from `ink`, which is the same multiplication historically
used as the component-ink pressure dial — note they compose multiplicatively.
If `CLAUDE.md` exists, remove its "wash is currently a no-op" line.

**Verify**: `grep -n "wash" halftone-kit/README.md` → the new line present.

## Test plan

Step 3's checks are the tests: a spec-resolution assertion, a call-count
assertion under the stubbed 2D context, and a real-pixel monotonicity check
(wash 0.3 < wash 1 ink count). Pattern: the existing color checks in
`verify-react-visual.mjs`.

## Done criteria

- [ ] Golden: `PASS — byte-identical` on the rebuilt dist (no re-baseline)
- [ ] `verify-core` ≥ 34, `verify-react-visual` ≥ 20, all other suites at
      baseline — 0 failed everywhere
- [ ] `grep -n "wash" halftone-kit/core/draw.js` shows the multiplier
- [ ] dist committed in the same commit as core
- [ ] `git status` clean outside in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- **Any golden canvas differs** after Step 2 — the FP-identity argument failed
  or something else changed; report the differing canvas list verbatim. Do NOT
  run `golden:write`.
- The docs engine turns out to pass a `wash` key in any of its `drawPress`
  grain objects (`grep -n "grain:" docs/index.html` and inspect) — then the
  default-1 argument doesn't apply; report before wiring.
- Adapter suites fail in a way implying a component defaulted wash to
  something other than 1/undefined.

## Maintenance notes

- `wash` and `ink` now compose multiplicatively — a future "dot gain" or
  "ink-train drift" motion feature (press-mechanics vocabulary) would animate
  exactly this multiplier; keep it a pure scalar.
- If wash is ever wanted on the AM plate path, that's a `drawPlates` design
  decision with its own golden implications — new plan, not a patch.
- Studio's inspector could now grow a wash dial (S effort) — deliberate
  follow-up, not part of this plan.
