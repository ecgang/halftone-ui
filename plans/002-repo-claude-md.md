# Plan 002: A repo-level CLAUDE.md captures the operational knowledge agents need

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8072748..HEAD -- CLAUDE.md tools/package.json`
> If CLAUDE.md already exists, STOP (someone beat you to it — reconcile, don't
> overwrite). If tools/package.json gained a `verify` script (plan 001 landed),
> document that command instead of the per-suite list.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (001 improves it — see drift check)
- **Category**: dx
- **Planned at**: commit `8072748`, 2026-07-17

## Why this matters

The repo's load-bearing operational knowledge exists nowhere in the repo: how to
verify (9 separate scripts), the mandatory `--disable-gpu` Playwright flag, the
golden-oracle workflow (what it is, when a `dist` rebuild is required, how to
regenerate), why there is no root package.json, and the fact that **pushing to
main deploys production**. Any agent or new contributor rediscovers these the
hard way — several were learned in this repo through multi-hour debugging
sessions. A CLAUDE.md is read automatically by Claude Code sessions in this
directory; it is the cheapest possible transfer of that knowledge.

## Current state

- No `CLAUDE.md` or `AGENTS.md` exists in the repo root (verify:
  `ls CLAUDE.md AGENTS.md` → both "No such file").
- The facts the file must capture are listed verbatim in Step 1 — they were
  extracted from the working history of this repo and verified against the code.
- Repo doc voice (match it): `README.md` is marketing-voiced; `halftone-kit/README.md`
  is engineer-voiced. CLAUDE.md should be terse and operational, closer to the
  latter. Source comments use long explanatory block comments about WHY.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Confirm harness inventory | `ls tools/verify-*.mjs` | 8 files |
| Confirm golden scripts | `grep golden tools/package.json` | 3 script lines |
| Sanity-run one suite | `node tools/verify-charts.mjs` | `14 passed, 0 failed` |

## Scope

**In scope**: `CLAUDE.md` (create, repo root). Nothing else.

**Out of scope**: README.md, halftone-kit/README.md, any source file, any tools
file. This plan writes exactly one new file.

## Git workflow

- One commit. Message style: short imperative title + why-body (match `git log`).
  Do NOT push.

## Steps

### Step 1: Write `CLAUDE.md` at the repo root

Include ALL of the following facts, organized under short headings
(Verification / Golden oracle / Layout & deploy / Library rules / Gotchas).
Keep it under ~120 lines. These facts are pre-verified — transcribe, don't
re-derive:

1. **Verification**: the 8 `node tools/verify-*.mjs` suites + what each covers
   (core lifecycle, plates, chart fields, react jsdom, vue jsdom, react pixels,
   vue pixels, studio e2e) and `npm run golden:check --prefix tools`. All run
   from repo root. (If plan 001 has landed: lead with
   `npm run verify --prefix tools` / `verify:quick`.)
2. **Playwright rule**: every pixel-readback harness must launch Chromium with
   `args: ['--disable-gpu']` — GPU-backed canvas readback is nondeterministically
   blank in headless Chromium (all canvases read 0 ink). Existing harnesses
   already do this; new ones must too.
3. **Golden oracle**: `tools/golden-frames.mjs` hashes 172 canvases × 2 themes
   in `dist/index.html` byte-identically. `dist/index.html` is a COMMITTED build
   artifact produced by `node tools/build-standalone.mjs` from `docs/index.html`
   and it INLINES `halftone-kit/core` — therefore **any core edit requires a
   dist rebuild + `golden:check`, even when docs/ is untouched**. Intentional
   visual changes: rebuild dist, eyeball, then `golden:write` to re-baseline.
4. **Layout & deploy**: static Vercel site; **push to `main` IS the production
   deploy** (halftone-ui.com). `docs/index.html` = source of the docs engine
   (legacy single-file app); `dist/` = its built artifact; `index.html` = landing;
   `studio/` = the Studio SPA (source in `studio/src`, committed self-contained
   `studio/index.html` built by `node tools/build-studio.mjs`); `halftone-kit/`
   = the library (framework-free `core/`, copy-in `react/` and `vue/` adapters).
   **Never create a root package.json** — Vercel would switch the static deploy
   to a Node build. `tools/` is the only npm root.
5. **Library rules**: adapters are copy-in via degit, not npm. Every component
   canvas is decorative — `aria-hidden="true"` is placed AFTER prop/attr spreads
   so callers cannot override it; semantics live in real DOM (`<button>`,
   `<progress>`, `<table>`). `core/charts.js` is imported directly by adapters
   and deliberately NOT re-exported from `core/index.js` (keeps it out of the
   docs bundle). Field contract: `field(u, v, p)` → tone 0..1; u,v normalized,
   v=0 is TOP; p is the raw pixel point escape hatch.
6. **Gotchas**: Vue's `watch` is lazy — never transplant React
   "skip-the-first-effect" guards (one ate the first prop change). React range
   inputs re-fire synthetic `onChange` per input event — commit undo history on
   the NATIVE `change` event. `wash` is currently resolved but not consumed by
   the kit draw path (see plan 006). Scene JSON import is untrusted: sanitizer
   clamps geometry AND press dials — keep it that way.

**Verify**: `wc -l CLAUDE.md` → > 40 and < 160; every fact above appears
(spot-check: `grep -c "disable-gpu\|golden\|degit\|aria-hidden\|package.json" CLAUDE.md` ≥ 5).

### Step 2: Accuracy pass against the live repo

For each command named in the file, run it once (cheap ones only: `verify-charts`,
`ls`, `grep`) and confirm the file's claims match reality.

**Verify**: `node tools/verify-charts.mjs` → `14 passed, 0 failed`; commands in
CLAUDE.md are copy-paste runnable.

## Test plan

No code tests — the "test" is the accuracy pass in Step 2.

## Done criteria

- [ ] `CLAUDE.md` exists at repo root, < 160 lines, covers all 6 fact groups
- [ ] Every command in it is copy-paste runnable from repo root
- [ ] `git status` shows only `CLAUDE.md` added
- [ ] `plans/README.md` status row updated

## STOP conditions

- `CLAUDE.md` already exists (reconcile instead — report).
- Any fact in Step 1 contradicts what you observe in the repo (report the
  contradiction; do not silently write what you observe — the discrepancy
  itself is the finding).

## Maintenance notes

- This file rots fastest at the verification section — any PR adding a harness
  or npm script should touch CLAUDE.md in the same commit.
- If plan 006 (wash wiring) lands, delete the wash gotcha line.
