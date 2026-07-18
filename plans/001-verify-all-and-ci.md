# Plan 001: One `verify` command runs every suite, and CI enforces it on every push

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8072748..HEAD -- tools/package.json .github`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `8072748`, 2026-07-17

## Why this matters

This repo deploys by pushing to `main` (Vercel serves the static tree — there is
no build step and no gate). It has nine verification harnesses plus a golden
byte-identity oracle, and **nothing runs any of them automatically**: no CI
exists (`.github/workflows/` is absent) and there isn't even a single local
command that runs them all — each must be typed by hand, so suites get skipped.
A broken canvas frame or adapter regression ships straight to production. After
this plan: `npm run verify --prefix tools` runs everything locally, and a
GitHub Actions workflow runs the same thing on every push and pull request.

## Current state

- `tools/package.json` — the ONLY npm root in the repo (deliberate: a root
  package.json would make Vercel treat the static site as a Node build — its own
  description field says exactly this; NEVER create a root package.json). Its
  scripts block today:

  ```json
  "scripts": {
    "golden:write": "node golden-frames.mjs --write",
    "golden:check": "node golden-frames.mjs --check",
    "golden:selftest": "node golden-frames.mjs --selftest"
  }
  ```

- The full harness inventory (all in `tools/`, all invoked as `node tools/<name>.mjs`
  **from the repo root** — they resolve repo paths relative to their own location,
  so running from `tools/` also works):

  | Harness | What it proves | Approx runtime |
  |---|---|---|
  | `verify-core.mjs` | core press lifecycle (24 checks) | seconds |
  | `verify-plates.mjs` | AM/plate compositing (8) | seconds |
  | `verify-charts.mjs` | chart field math, pure Node (14) | <1s |
  | `verify-react.mjs` | React adapter lifecycle under jsdom (40) | ~10s |
  | `verify-vue.mjs` | Vue adapter lifecycle under jsdom (46) | ~10s |
  | `verify-react-visual.mjs` | React real pixels, headless Chromium (19) | ~30s |
  | `verify-vue-visual.mjs` | Vue real pixels, headless Chromium (19) | ~30s |
  | `verify-studio.mjs` | Studio end-to-end, headless Chromium (38) | ~60s |
  | `golden-frames.mjs --check` | 172 docs canvases × 2 themes byte-identical | ~3min |

- Every Playwright-based harness already launches Chromium with
  `args: ['--disable-gpu']` internally (GPU canvas readback is
  nondeterministically blank headless) — CI needs no extra flag, but DOES need
  the Chromium binary installed (`npx playwright install`).
- All harnesses exit 0 on success and 1 on any failure, printing
  `N passed, M failed` (golden prints `PASS — every canvas is byte-identical`).

## Commands you will need

| Purpose | Command (from repo root) | Expected on success |
|---|---|---|
| Install harness deps | `npm ci --prefix tools` | exit 0 |
| Install browser | `npx --prefix tools playwright install chromium` | exit 0 |
| Any single suite | `node tools/verify-core.mjs` | `24 passed, 0 failed`, exit 0 |
| Golden | `npm run golden:check --prefix tools` | `PASS — every canvas is byte-identical`, exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `tools/package.json` (add scripts only — do not touch deps)
- `tools/verify-all.mjs` (create)
- `.github/workflows/verify.yml` (create)

**Out of scope** (do NOT touch):
- Any `tools/verify-*.mjs` harness, `tools/golden-frames.mjs` — they are the
  tested contract; this plan only orchestrates them.
- Repo root — NO root `package.json`, ever (breaks the Vercel static deploy).
- `docs/`, `dist/`, `halftone-kit/`, `studio/`.

## Git workflow

- Branch: work directly on the current branch unless the operator says otherwise.
- One commit per step; message style matches repo (`git log`): a short imperative
  title line, then a wrapped body explaining why. Do NOT push.

## Steps

### Step 1: Create `tools/verify-all.mjs`

A small Node script (ESM, `type: module` is already set) that runs each harness
as a child process **sequentially** (the Chromium harnesses contend for
resources if parallelized), streams output, and exits non-zero if any fails.
Order fast-to-slow so cheap failures surface first: charts, core, plates,
react, vue, react-visual, vue-visual, studio, then golden (`golden-frames.mjs`
with `--check`). Accept a `--no-golden` flag that skips the golden step (local
quick loop). Use `spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' })`
with paths resolved from `import.meta.url` — mirror the style of the existing
`execFileSync(process.execPath, ...)` call at `tools/verify-studio.mjs:21`.
Print a final one-line summary table of suite → pass/fail.

**Verify**: `node tools/verify-all.mjs --no-golden` → every suite runs, final
summary shows all passing, exit 0. Then `node tools/verify-all.mjs` → same plus
the golden PASS (allow ~5 min).

### Step 2: Add npm scripts

In `tools/package.json` scripts, add:

```json
"verify": "node verify-all.mjs",
"verify:quick": "node verify-all.mjs --no-golden"
```

**Verify**: `npm run verify:quick --prefix tools` → all suites pass, exit 0.

### Step 3: Create `.github/workflows/verify.yml`

```yaml
name: verify
on:
  push: { branches: [main] }
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: tools/package-lock.json }
      - run: npm ci --prefix tools
      - run: npx --prefix tools playwright install --with-deps chromium
      - run: npm run verify --prefix tools
```

Notes: `--with-deps` pulls Chromium's system libraries on the runner. The
harnesses already self-apply `--disable-gpu`. The golden check needs no fonts
beyond Chromium's bundle — it hashes canvases the page itself rasterizes.

**Verify**: `npx --yes action-validator .github/workflows/verify.yml` if
available; otherwise `node -e "require('js-yaml')"` is NOT available — instead
verify with `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/verify.yml'))"`
→ exit 0. Full pipeline proof happens on the first push (operator's push, not yours).

## Test plan

The harnesses ARE the tests; this plan adds no new assertions. The new surface
(`verify-all.mjs`) is verified by running it both ways in Steps 1–2 and by
temporarily breaking one suite locally if you want confidence: run
`node tools/verify-all.mjs --no-golden`, confirm exit 0; no committed change
should be made to force a failure.

## Done criteria

- [ ] `npm run verify:quick --prefix tools` exits 0 with all 8 suites passing
- [ ] `npm run verify --prefix tools` exits 0 including golden
- [ ] `.github/workflows/verify.yml` exists and parses as YAML
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] No `package.json` exists at the repo root
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any harness fails BEFORE your changes (pre-existing breakage — the baseline
  must be green first; report which suite and its tail output).
- You find yourself wanting to modify a harness to make orchestration work.
- The golden check fails after your changes (you should not have touched
  anything it hashes — if it fails, something unexpected happened; report).
- CI design requires a root package.json (it doesn't — use `--prefix tools`).

## Maintenance notes

- New harnesses must be added to `verify-all.mjs`'s list — reviewers should ask
  "is the new suite in verify-all?" on any PR adding a `tools/verify-*.mjs`.
- Plan 004 adds a new unit harness (`verify-vectors.mjs`); if it has landed
  first, include it in the list (fast tier, right after `verify-charts.mjs`).
- Golden runtime dominates CI (~3 min). If CI time becomes a problem, split
  golden into a separate job — do not drop it.
