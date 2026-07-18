# Plan 005: Studio drags stop reconciling every frame; adapters share one sr-only recipe and one dial-prop shape

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8072748..HEAD -- studio/src halftone-kit/react halftone-kit/vue tools/verify-studio.mjs`
> On drift, re-verify every "Current state" excerpt before editing.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf + tech-debt
- **Planned at**: commit `8072748`, 2026-07-17

## Why this matters

Three small, verified inefficiencies: (1) dragging one Studio frame dispatches a
store update per pointermove, and with no memoization every `FrameView` subtree
re-reconciles on each of them — O(frames) React work per mouse event; (2) an
`<Image>` gamma/gain scrub calls `rebuild()`, re-running the full Poisson
point sampling (the most expensive per-surface op) when only tone changed — the
core handle already has the cheap `draw()`, but the adapter facade doesn't
expose it; (3) the a11y-critical sr-only style is hand-copied in four adapter
files and has already drifted between them (numeric props vs `'1px'` strings vs
a raw CSS string), and the Vue dial-prop shape is re-declared per component
despite `vue/chart.js` already demonstrating the shared-object pattern.

## Current state

- `studio/src/stage.jsx:105` — `frames.map((f) => (f.visible ? <FrameView .../>`
  renders all frames; `studio/src/frames.jsx:77` — `export function FrameView({ frame, selected, zoom, dispatch })`
  and `:26` `function FrameBody({ frame })` — neither wrapped in `React.memo`
  (`grep -rn "memo" studio/src` → no hits). The store (`studio/src/store.js`)
  is immutable — unchanged frames keep referential identity across dispatches,
  so memo bail-out works naturally. `dispatch` from `useReducer` is stable.
- `halftone-kit/react/use-press.js:52-58` — the stable facade:

  ```js
  return useMemo(() => ({
    get current() { return handleRef.current; },
    set: (patch) => handleRef.current?.set(patch),
    rebuild: () => handleRef.current?.rebuild(),
    pressIn: (ms) => handleRef.current?.pressIn(ms),
    proof: () => handleRef.current?.proof() ?? null,
  }), []);
  ```

  No `draw`. The core handle DOES expose it (`halftone-kit/core/press.js:163`
  `draw: () => s.draw()`). Same shape in `halftone-kit/vue/use-press.js`.
- `halftone-kit/react/image.jsx:90` — `useEffect(() => { press.rebuild(); ... }, [gamma, gain])`;
  `halftone-kit/vue/image.js:116` — `watch([gamma, gain], () => press.rebuild())`
  (line ~; grep `rebuild` in that file). gamma/gain feed only the field's tone
  math, never geometry.
- SR_ONLY copies: `halftone-kit/react/chart.jsx:15`, `react/meter.jsx:14`
  (numeric-prop object), `vue/chart.js:15` (string-prop object), `vue/meter.js:14`
  (raw CSS string). All implement the same visually-hidden recipe.
- `halftone-kit/vue/chart.js:38-46` — the existing shared shape to generalize:

  ```js
  const dialProps = {
    screen: { type: String, default: undefined },
    scale: { type: [Number, String], default: undefined },
    r: { type: [Number, String, Function], default: undefined },
    ink: { type: [Number, String], default: undefined },
    roll: { type: [Number, String], default: undefined },
    seed: { type: [Number, String], default: undefined },
    color: { type: String, default: undefined },
  };
  ```

  `vue/meter.js:25-32`, `vue/image.js:21-30`, and the other Vue components
  re-declare equivalent shapes inline (some also declare `wash`, `h`,
  `animate`, `pressMs` — keep those local; share only the seven dial keys).
- Repo conventions: explanatory block comments about WHY; adapters are copy-in
  folders, so new shared files ship to consumers — name them clearly
  (`_a11y.js`, `_props.js`) and give each a one-paragraph header comment.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| React jsdom | `node tools/verify-react.mjs` | `40 passed, 0 failed` |
| Vue jsdom | `node tools/verify-vue.mjs` | `46 passed, 0 failed` |
| React pixels | `node tools/verify-react-visual.mjs` | `19 passed, 0 failed` |
| Vue pixels | `node tools/verify-vue-visual.mjs` | `19 passed, 0 failed` |
| Studio e2e | `node tools/verify-studio.mjs` | `50 passed, 0 failed` |

(Counts reconciled at `d5a9c4e`; if a step adds checks, expect more. The drift check WILL show
`studio/src/store.js`, `studio/src/presets.js`, `studio/src/app.jsx`, `studio/src/inspector.jsx`
and `tools/verify-studio.mjs` changed since `8072748` — that is the security-hardening work, all
OUT of this plan's scope; none of it touched `frames.jsx`, `stage.jsx`, or the adapter files this
plan edits. Re-verify excerpts for the files you touch and proceed.)

## Scope

**In scope**:
- `studio/src/frames.jsx`, `studio/index.html` (rebuilt via
  `node tools/build-studio.mjs` — never hand-edited)
- `halftone-kit/react/use-press.js`, `react/image.jsx`, `react/chart.jsx`,
  `react/meter.jsx`, `react/_a11y.js` (create)
- `halftone-kit/vue/use-press.js`, `vue/image.js`, `vue/chart.js`,
  `vue/meter.js`, `vue/_a11y.js` (create), `vue/_props.js` (create), and the
  other `vue/*.js` components ONLY for the dialProps import swap

**Out of scope**:
- `halftone-kit/core/**` — nothing here needs core; if a step seems to, STOP.
- `docs/`, `dist/` — untouched; golden is unaffected by adapter/studio changes.
- Behavior changes of any kind — this plan is perf + dedup, pixel-identical.

## Git workflow

- Three commits, one per step-group (memo; draw-facade; shared modules).
  Imperative title + why-body. Do NOT push.

## Steps

### Step 1: Memoize Studio frames

In `studio/src/frames.jsx`: wrap `FrameView` — `export const FrameView = React.memo(function FrameView({ frame, selected, zoom, dispatch }) { ... })`
(keep the named function for devtools). Do the same for `FrameBody` if it is
rendered from `FrameView` with a stable `frame` prop. Rebuild:
`node tools/build-studio.mjs`.

**Verify**: `node tools/verify-studio.mjs` → all pass (drag/undo checks prove
behavior held). Optional perf proof: add a temporary render counter — do NOT
commit it.

### Step 2: Expose `draw()` on both facades; repaint (not rebuild) on gamma/gain

- `react/use-press.js` facade: add `draw: () => handleRef.current?.draw(),`.
- `vue/use-press.js` facade: same addition.
- `react/image.jsx:90`: `press.rebuild()` → `press.draw()` in the gamma/gain
  effect (comment: tone-only change; geometry unchanged, so skip the Poisson
  re-sample).
- `vue/image.js`: same swap in its `[gamma, gain]` watch.

**Verify**: all four adapter suites pass at baseline counts. Then add ONE check
to `tools/verify-react.mjs`'s Image section: after mount+load, a gamma prop
change must NOT re-run point generation — assert via the facade that a redraw
happened (clears increased) — and mirror it in `verify-vue.mjs` if cheap.

### Step 3: Shared `_a11y.js` and `_props.js`

- Create `halftone-kit/react/_a11y.js` exporting the canonical `SR_ONLY`
  object (use the numeric-prop React variant as canon); import it in
  `react/chart.jsx` + `react/meter.jsx`, deleting the local copies.
- Create `halftone-kit/vue/_a11y.js` exporting the same recipe in the
  string-value shape Vue style-binding expects; import in `vue/chart.js` +
  `vue/meter.js` (replace the raw CSS string in meter with the object form so
  there is exactly one representation per framework).
- Create `halftone-kit/vue/_props.js` exporting `dialProps` (the seven keys
  above); in every `vue/*.js` component replace the inline dial declarations
  with `...dialProps` spread, keeping component-specific props (`wash`, `h`,
  `value`, `text`, `src`, `as`, `data`, …) declared locally. `vue/chart.js`
  imports it instead of declaring its own.

**Verify**: `node tools/verify-vue.mjs` (46+), `verify-react.mjs` (40+),
both visual suites, `verify-studio.mjs` — all pass. The aria-hidden and
`<progress>`/`<table>` checks in the jsdom suites are the a11y regression net.

## Test plan

Existing suites are the net (they assert sr-only elements stay in the a11y
tree, dials still flow, drags still coalesce). New checks: the Step 2
gamma-repaint assertion (one per adapter harness).

## Done criteria

- [ ] All five suites pass at ≥ baseline counts
- [ ] `grep -rn "position: 'absolute', width: 1" halftone-kit/react` → only `_a11y.js`
- [ ] `grep -c "dialProps" halftone-kit/vue/_props.js` ≥ 1 and no Vue component
      declares its own `screen:`/`scale:` dial props inline (grep each)
- [ ] `studio/index.html` rebuilt and committed with frames.jsx
- [ ] `git status` clean outside in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- Memoization changes any verify-studio behavior check (selection sync,
  drag-one-undo) — the memo comparator is wrong; stop rather than deepen it.
- The gamma-repaint swap makes an Image test fail in a way that suggests
  gamma/gain DO affect geometry somewhere — report, don't force.
- The Vue prop-spread changes any component's observable props (verify-vue
  aria/dial checks fail) — stop and report which component.

## Maintenance notes

- New adapter components should import `_a11y.js` / `_props.js` rather than
  re-declaring; reviewers should flag inline sr-only or dial-prop blocks.
- If a future component needs a per-frame memo comparator in Studio (e.g.
  frames that re-render on camera), extend `React.memo`'s comparator rather
  than removing it.
