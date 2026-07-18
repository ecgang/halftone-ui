# halftone-kit

You just `degit`'d one or more of these folders into your own repo. There's no package, no version
to bump, no changelog to track — this file is the reference for the code you now own.

```
halftone-kit/
├── core/    framework-free engine — SSR-safe, zero deps
├── react/   thin adapter over ../core — Provider + hooks + JSX primitives
└── vue/     thin adapter over ../core — Provider + composable + render-fn primitives
```

`react/` and `vue/` both import `../core` by relative path. If you copied an adapter, copy `core/`
beside it (same parent directory) — that's the only structural requirement.

## `core/` — the engine

Framework-free, DOM-free at import time, safe to import under SSR. Its whole job is turning a
**tone field** into ink on a canvas.

### The field contract

```
field(u, v, p) -> tone   // tone in 0..1, 0 = no ink, 1 = full ink
```

- `u` — `x / W`, normalized horizontal position, `0` = left, `1` = right.
- `v` — `y / H`, normalized vertical position, **`0` = top, `1` = bottom.** Baseline-anchored marks
  (bars, meters) fill from the bottom, i.e. `v >= 1 - height`.
- `p` — the raw pixel point (`p.x`, `p.y`), for callers who need un-normalized coordinates (e.g.
  `textField`'s raster sampling reads `p.x`/`p.y` directly instead of `u`/`v`).

A field is the entire surface of a component: `Surface`/`Text`/`Image`/the chart primitives are
each just a `field` plus some bookkeeping to build one.

### The press lifecycle

```
createPressContext(opts) -> ctx
resolvePress(opts, ctx)  -> spec     // pure — no DOM, unit-testable
mount(el, spec, ctx)     -> handle   // impure — owns the canvas, the rAF loop, the registry entry
press(el, opts, ctx)                 // = mount(el, resolvePress(opts, ctx), ctx)
```

- **`createPressContext(opts)`** builds one instance's shared state: theme, grain dials, seed/roll,
  ink palette, and a registry of the surfaces mounted against it. Build **one per app/page** and
  share it — two contexts on one page are fully independent (different themes, different seeds).
  Key methods: `setTheme`, `setRoll`, `setPal`, `palette(name)`, `ink(name)`, `fore()`, `repaint()`.
- **`resolvePress(opts, ctx)`** merges instance opts over context defaults over built-ins into a
  plain spec object. Pure — no side effects, safe to call in a test with no canvas.
  - Two render dials multiply the field's tone before the screen thresholds it: `ink` is the
    component's own pressure dial; `wash` scales the whole field's tone the way the docs' wash
    surfaces scale theirs (0 = blank, 1 = as authored, >1 darkens). They compose multiplicatively
    and both default to `1`.
- **`mount(el, spec, ctx)`** binds that spec to a real `<canvas>` element and returns the imperative
  **handle**:
  - `handle.set(patch)` — merge a patch. Geometry keys (`screen`, `scale`, `r`, `h`, `roll`) force a
    `rebuild()` (repositions the point grid); everything else just repaints in place. **Strip
    `undefined` keys before calling** — `Object.assign` with an `undefined` value blanks a resolved
    default instead of leaving it alone.
  - `handle.rebuild()` — recompute the point grid + noise field from scratch (a resize, a `roll`
    bump).
  - `handle.pressIn(ms)` — animate the ink ramping in from 0 to full over `ms` (default from
    `spec.pressMs`).
  - `handle.proof()` — settle to the resting frame and return a `dataURL` of the current frame.
  - `handle.destroy()` — **must run on teardown.** It cancels any in-flight animation frame and
    removes the surface from the context's registry. Skipping it is the leak: the registry keeps
    growing and never shrinks. Both adapters call this automatically on unmount; if you're driving
    `mount()` by hand, you own calling `destroy()`.

## `react/` and `vue/` — the adapters

Both are thin: one `<HalftoneProvider>` that owns exactly one `createPressContext` for its subtree
(built once, never rebuilt from prop changes — its registry is live state), a `usePress` bridge
that mounts once per (context, element) pair and calls `handle.destroy()` on unmount, and the
pressed-canvas primitives built on top of it: `Surface`, `Text`, `Image`, `Button`, `Meter`, `Card`,
`BarChart`, `LineChart`.

`react/` is authored in `.jsx` — your bundler compiles it like the rest of your app. `vue/` is
authored as plain `defineComponent` + `h()` render functions, no `.vue` SFCs — nothing to compile,
it works as committed.

Both providers also read the page's CSS custom properties (`--ink`, `--blue`, `--orange`, …) via
`getComputedStyle` on mount and feed them into the context's palette, so a plain `<Surface>` inks
itself from your theme without any wiring. They also mirror `prefers-reduced-motion` onto the
context (`ctx.reduced`), which `pressIn` checks before animating.

## Copy-in philosophy

This is a shadcn/dither-ui-style copy-in library, not a versioned dependency. That means:

- No `npm i` to fall behind on, no breaking-change major-version migration to schedule.
- You can edit any of these files directly — rename props, change a default, delete a component you
  don't use. It's your code now.
- Updates don't come as a version bump. If you want a later revision, re-run the `degit` command
  for the folder(s) you want and reconcile the diff yourself.
- The tradeoff is the one you'd expect: no upstream bugfixes land automatically, and drift between
  copies in different apps is on you to manage.

## Accessibility stance

**Every `<canvas>` this library renders is decorative.** Each primitive sets `aria-hidden="true"`
on its canvas *after* spreading through any caller props/attrs, specifically so a caller can't
accidentally un-hide it. All real semantics live in ordinary DOM elements next to (or wrapping) the
canvas:

- `Button` renders a real `<button>` — focus ring, keyboard activation, and accessible name all
  come from the native element; the halftone fill sits behind the label.
- `Meter` renders a real `<progress>` (visually hidden via the standard sr-only clip pattern, but
  still in the accessibility tree) carrying the actual value/max.
- `Card` renders a real container element (`div` by default, override with `as`) around your
  children — the backdrop is decoration.
- `BarChart`/`LineChart` render a real `<table>` with a `<caption>` (also sr-only-visible) holding
  the actual data rows — screen readers read numbers, sighted users read ink.
- `Text`/`Image`/`Surface` have no built-in semantic partner — pair them with your own
  visually-hidden heading or `<img alt>`.

## Charts as fields

Chart geometry is just more tone fields, exported directly from `core/charts.js` — **not** re-exported through `core/index.js`, so import them by explicit path:

```js
import { barsField, areaField, lineField } from '../core/charts.js'
```

- `barsField(values, { max, gap })` — vertical bars, baseline-anchored, `gap` is the blank fraction
  between columns (0–0.9).
- `areaField(values, { max })` — the filled region under a polyline through the values.
- `lineField(values, { max, stroke })` — a stroked polyline; `stroke` is the half-thickness in
  normalized `v` units.

All three share one `heights()`/`max` scale so bars and lines drawn together sit on one axis. The
adapters' `<BarChart>`/`<LineChart>` are just these fields handed to `<Surface>` next to a real
`<table>` — reuse them directly if you're building a chart shape the adapters don't cover.
