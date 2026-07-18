# Plan 003: Docs-site code samples teach the real halftone-kit API, not the fictional one

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8072748..HEAD -- docs/index.html dist/index.html halftone-kit/react/index.js halftone-kit/vue/index.js`
> On any drift, re-verify the "Current state" excerpts before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — docs/index.html edits shift page layout, which changes
  layout-dependent canvas pixels; the golden baseline must be deliberately
  re-baselined (Step 5), not blindly overwritten.
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `8072748`, 2026-07-17

## Why this matters

The live docs site (halftone-ui.com/docs/) is the primary onboarding surface,
and every framework snippet on it is fiction: `# npm i @halftone-ui/vue`
(no npm packages exist — distribution is degit copy-in), imports of `HButton`/
`HMeter` (the real exports are `Button`/`Meter`), and imports of `toast` (no
adapter exports it). ~90 React and ~90 Vue sample mentions predate the real
adapters in `halftone-kit/`. Copy-pasting any of them fails. Actively-wrong
docs are worse than missing docs.

## Current state

- `docs/index.html` (4857 lines) — the single-file docs engine. Code samples
  sit in `.codewrap` blocks as paired `<pre data-lang="vue">` /
  `<pre data-lang="react" hidden>` elements with `<span>` syntax highlighting.
  Example of the broken shape (docs/index.html:768–786):

  ```html
  <pre data-lang="vue"><span class="c"># npm i @halftone-ui/vue</span>
  ...
  <span class="k">import</span> { HButton, HMeter } <span class="k">from</span> <span class="s">"@halftone-ui/vue"</span>
  ```

  Also wrong: `docs/index.html:758-759` prose claims "`@halftone-ui/vue` and
  `@halftone-ui/react` are thin adapters" and the engine is "plain TypeScript"
  (it is plain JavaScript); `docs/index.html:1548,1551` import a nonexistent
  `toast`.
- The REAL API (verify before writing each sample):
  - React barrel `halftone-kit/react/index.js` exports: `HalftoneProvider`,
    `useHalftoneContext`, `HalftoneContext`, `usePress`, `Surface`, `Text`,
    `Image`, `Button`, `Meter`, `Card`, `BarChart`, `LineChart`.
  - Vue barrel `halftone-kit/vue/index.js` exports the same names (no `H`
    prefix, no `toast`). Vue consumers CAN use SFC `<template>` syntax — the
    no-SFC rule applies to the library's own source, not to consumers.
  - Install story (already correct in `README.md` "Install" section — reuse its
    exact commands): `npx degit ecgang/halftone-ui/halftone-kit/react your-app/src/halftone/react`
    plus core beside it; imports are relative: `"./halftone/react/index.js"`.
  - Real props (spot-check in source before use): `Button` takes `color`,
    `screen`, native button attrs; `Meter` takes `value` (0..1 or with `max`),
    `h`, `color` — there is NO `label` prop on Meter (`halftone-kit/react/meter.jsx`).
- The golden oracle: `tools/golden-frames.mjs --check` hashes 172 canvases × 2
  themes in `dist/index.html`, which is BUILT from docs/index.html by
  `node tools/build-standalone.mjs`. Layout-height changes (a taller/shorter
  `<pre>`) legitimately change wash-canvas pixels → the golden WILL flag
  diffs; Step 5 handles re-baselining deliberately.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rebuild dist | `node tools/build-standalone.mjs` | `wrote dist/index.html (...)` |
| Golden check | `npm run golden:check --prefix tools` | PASS, or a NAMED list of differing canvases |
| Re-baseline | `npm run golden:write --prefix tools` | new baseline written |
| Full sweep | `grep -n "halftone-ui/vue\|halftone-ui/react\|HButton\|HMeter\|HCard\|HTabs\|npm i @halftone" docs/index.html` | (used to find work / verify done) |

## Scope

**In scope**:
- `docs/index.html` — sample `<pre>` blocks, the :758-759 prose, section text
  that names npm packages.
- `dist/index.html` — rebuilt artifact (never hand-edited).
- `tools/golden/` baseline — via `golden:write` only, in Step 5 only.

**Out of scope**:
- `halftone-kit/**` (the API is the source of truth — docs conform to it, never
  the reverse), `studio/`, `index.html` (landing), `README.md`,
  `tools/*.mjs` scripts themselves.
- The docs engine's own JS (the `<script>` body of docs/index.html) — you are
  editing sample TEXT and prose only. If a fix seems to require engine-JS
  changes, STOP.

## Git workflow

- One commit per step-group is fine; final commit includes docs + dist + golden
  baseline together (they must move atomically). Message style: imperative
  title + why-body. Do NOT push.

## Steps

### Step 1: Inventory every sample

`grep -n "data-lang=" docs/index.html` → list of paired samples. For each pair,
identify the component it demonstrates and whether the kit exports it
(the 8: Surface, Text, Image, Button, Meter, Card, BarChart, LineChart —
plus Provider/usePress).

**Verify**: a written list (in your working notes) of every sample line range,
each classified `kit-export` or `no-kit-equivalent`.

### Step 2: Rewrite `kit-export` samples

For each: replace the `# npm i @halftone-ui/x` comment line with
`# npx degit ecgang/halftone-ui/halftone-kit/<fw> src/halftone/<fw>` (one line);
fix import path to `"./halftone/react"` / `"./halftone/vue"`; fix names to the
real exports (`HButton`→`Button`, `HMeter`→`Meter`, etc.); fix props that don't
exist (e.g. Meter `label` — wrap in your own `<label>` instead). Preserve the
existing `<span class>` highlighting structure — edit text inside spans, add or
remove spans matching the established classes (`c` comment, `k` keyword, `s`
string) as needed.

**Verify**: `grep -c "HButton\|HMeter\|@halftone-ui/" docs/index.html` → 0.

### Step 3: Rewrite `no-kit-equivalent` samples (toast, etc.)

Replace the fictional adapter import with the core escape hatch, clearly
labeled. Shape:

```
# not yet a kit component — pressed with the framework-free core
import { createPressContext, press } from "./halftone/core/index.js"
```

…followed by a minimal real `press(el, { field })` call appropriate to the demo.
Do not invent adapter APIs.

**Verify**: `grep -n "toast" docs/index.html | grep -i import` → no adapter
imports remain.

### Step 4: Fix the prose

docs/index.html:758-759 — rewrite to: the engine is plain JavaScript; `react/`
and `vue/` in `halftone-kit/` are thin copy-in adapters over the same core
(degit, not npm).

**Verify**: `grep -n "plain TypeScript" docs/index.html` → 0 matches.

### Step 5: Rebuild dist and re-baseline the golden DELIBERATELY

1. `node tools/build-standalone.mjs`
2. `npm run golden:check --prefix tools` — EXPECT possible diffs confined to
   layout-dependent canvases (washes / full-page surfaces). Read the diff list.
3. If diffs are confined to those: open `dist/index.html` in a browser (or run
   the golden's own screenshot mode if present) and eyeball that pages render
   correctly — then `npm run golden:write --prefix tools` and re-run
   `golden:check` → PASS.
4. If diffs include component demo canvases (buttons, charts, masthead), you
   changed something you shouldn't have — STOP.

**Verify**: `npm run golden:check --prefix tools` → PASS on the new baseline.

## Test plan

No JS tests — verification is the grep gates above plus the golden cycle. As a
copy-paste smoke test, extract one rewritten React sample and one Vue sample
into scratch files and confirm every imported name exists:
`grep "export" halftone-kit/react/index.js` covers each import used.

## Done criteria

- [ ] `grep -c "HButton\|HMeter\|@halftone-ui/" docs/index.html` → 0
- [ ] No adapter `toast` imports remain
- [ ] Every import name used in any sample exists in the corresponding barrel
- [ ] `node tools/build-standalone.mjs` run; dist committed with docs
- [ ] `npm run golden:check --prefix tools` → PASS (post re-baseline)
- [ ] `git status` clean outside in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- A sample's fix seems to require changing docs-engine JS or kit source.
- Golden diffs appear on component-demo canvases (not just layout washes).
- You cannot find a real-API equivalent for a sample and the core fallback
  (Step 3) doesn't fit either — report the section, don't invent API.
- More than ~40 sample pairs exist (inventory much larger than audited) —
  report the count first.

## Maintenance notes

- Future kit API changes must sweep docs samples — until then, the Step 2 grep
  gate (`HButton|@halftone-ui/`) makes a good CI guard if plan 001's workflow
  wants a cheap extra step.
- The golden baseline changed in this plan; note the re-baseline commit SHA in
  the commit body so future byte-drift archaeology has an anchor.
