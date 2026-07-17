# Spec — `halftone-kit`: extracting the press into a usable library

**Status:** approved to spec (Eric, 2026-07-17). Not approved to build.
**Decisions taken:** React/Next adapter first (Vue second) · folder-via-degit distribution (shadcn model) · v1 scope = press primitive + Surface/Text/Image + chrome + charts.

---

## 1. Goal

Make `docs/index.html`'s engine into something a person can put in their own project, without losing what makes it ours: a **press applied to real component surfaces**, with semantics and a11y coming from real DOM underneath (real buttons, real inputs, the masthead a real `<h1>` behind an `aria-hidden` canvas).

**Non-goals for v1:** an npm package (explicitly deferred), a Vue adapter (phase 4), SSR *rendering* of canvases (only SSR-safe *import*), and porting all 88 docs sections as components (they are demo sections, not components — see §5).

## 2. Why this isn't a packaging job

The docs site is **4,988 lines / 267KB in one file, with two `<script>` blocks and zero exports** — the entire engine is inside one IIFE. It works *because it owns the whole page*. That is precisely the assumption a component may never make. Every blocker below is a consequence of that single fact.

dither-ui's distribution (`npx degit`, no build, no publish) deletes the *packaging* half of this work — which is why we're copying it. It does not touch a single blocker below. **Per-instance-clean code is the whole job either way.**

## 3. Current state — the five blockers (verified 2026-07-17 against `e7c869e`)

| # | Blocker | Verified evidence |
|---|---|---|
| 1 | **Registry leaks on unmount** | `const registry = []` at `docs/index.html:3116`; **5 `registry.push` sites** (3172, 3570, 3630, 3805, 4952); **0 removal sites** (`registry.splice`/reassign = 0). Any mount/unmount cycle grows it forever and redraws dead canvases. |
| 2 | **Global mutable singletons** | `GRAIN` :3007, `state` (seed) :3107, `PAL` :3110, `INKS` :3657, `THEME` :4703. Two instances on one page cannot hold different settings — the second overwrites the first. |
| 3 | **Four draw paths, not one** | Tone→radius is reimplemented at **4 sites**: shared surface draw :3148–3161 (two branches), area chart :3492–3494, bar chart :3602–3610, masthead :4932–4944. Each needs teaching separately — the `if (p.c)` am-guard exists at **3 of them** (3150, 3493, 3609) exactly because of this. R12c already proved the cost: `GRAIN.ink` silently skipped both bespoke chart draws. |
| 4 | **Module-init browser globals break SSR** | `const reduced = matchMedia(…)` :3108 and `const grainIO = ('IntersectionObserver' in window)` :3203 evaluate **at import** → `ReferenceError` in Node before any component mounts. ⚠️ **Correction to prior notes: `localStorage` is *not* the problem** — the `store` helper (:2958–2961) is properly try/catch-guarded and returns `null` under Node. The SSR break is `matchMedia`/`window`, not storage. |
| 5 | **DOM-scanning wiring** | **133 sites**: 51 `getElementById`, 30 `querySelector`, 52 `querySelectorAll` — the engine finds its own elements instead of taking refs the caller owns. (Also why the unguarded `#mast-cv` lookup was accepted as a known gap: it's 1 of 51 identical sites, and they all get restructured *here*.) |

## 4. Target architecture

### 4a. The two ideas that collapse the whole thing

**Everything is a tone field.** `field: (x, y) => number` in `0..1`. Text (`textField` :3048), photo luminance, chart geometry, SDF marks — all of these are *already* this internally; the engine just doesn't say so. Make it the public contract.

**A plate is `{ ink, ang, dx, dy, w(u, v) }`.** This abstraction **already exists** — the masthead's plates carry a per-plate weight function (`:4866–4869`, consumed at `pl.w(p.x/W, p.y/H)` :4932). The area chart "stacks 4 screens by depth" and the bar chart "encodes value twice" are *the same idea, hand-written twice*. Expressing them as plate weights is what collapses **4 draw paths → 1**:

```js
drawPress(ctx, { pts, field, plates, screen, grain, pr })
```

Every existing draw becomes one call with different plates and a different field. Blocker 3 dies, and with it the "teach every new screen three times" tax.

### 4b. The public API

```js
import { press, createPressContext } from './halftone-kit/core'

const p = press(canvasEl, {
  field,                    // (x,y) => 0..1   — REQUIRED, the tone
  screen: 'hatch',          // stipple | lines | waves | hatch | am
  scale: 1, ink: 1, wash: 1,
  seed: 1859,
  inks: ['blue', 'orange'], // omit → mono
  plates,                   // optional explicit plates (masthead / charts)
  animate: true,            // press-in when scrolled into view
  harmony: true,
})

p.draw(); p.rebuild(); p.set({ ink: 1.4 }); p.proof(); p.destroy()
```

- **`destroy()` is the whole point.** It cancels the in-flight rAF via the existing generation token, disconnects the observer, and unsubscribes from the repaint bus. **The caller owns the lifecycle** — this kills blockers 1 and 5 simultaneously.
- **Config resolution: instance opts → context defaults → built-ins.** `createPressContext({ scale, ink, theme, seed, persist })` replaces every global; `<HalftoneProvider>` wraps it for React. Blocker 2 dies.
- **`registry` becomes a per-context `Set`**, and `destroy()` removes from it.
- **Nothing browser-touching at import.** `reduced` and the observer are resolved lazily on first mount. `press()` requires an element, which implies a browser — so the *import* stays pure. Blocker 4 dies.
- **Colors must stay lazy.** Theming works today only because colors are passed as getters (`() => PAL.x`) and resolved at *draw* time, and because `tuneInk`/`tuneMix` run in the same pass. The core must preserve that laziness or the OKLCH wheel and the harmony pass both break.

### 4c. Verifier Contract (§4b) — falsifiable, default-to-fail

| ID | Criterion | How it's checked |
|---|---|---|
| **V-1** | Two `press()` instances on one page with different `scale`/`screen`/`seed` each render per their own config; neither mutates the other. | Two canvases, differing opts, hash both; assert both differ from each other *and* each matches its solo-rendered hash. |
| **V-2** | Mount→destroy ×100 leaves no growth. | `ctx.size` returns to baseline; 0 live rAF; 0 connected observers. |
| **V-3** | Import is SSR-safe. | `node -e "import('./halftone-kit/core')"` with no `window`/`document`/`matchMedia` → no throw. |
| **V-4** | **GOLDEN FRAME — every docs canvas is byte-identical pre- vs post-extraction.** | Canvas hash at matched dpr/seed/config, **equal readback counts on both sides**, **`localStorage` cleared on both origins**, config recorded alongside each hash. (See §6 — this is the load-bearing one.) |
| **V-5** | Exactly **one** tone→radius draw site in core. | Static count == 1 (today: 4 — 3148/3492/3602/4932). |
| **V-6** | Core has 0 framework imports and 0 runtime deps. | Dependency graph of `core/`. Charts may take `d3-scale`/`d3-shape`; core may not. |
| **V-7** | `destroy()` during an in-flight press run leaves no live rAF. | Generation token honored; assert callback count stops. |
| **V-8** | Core makes **zero** DOM lookups. | `getElementById|querySelector|querySelectorAll` in `core/` == 0 (today: 133). |
| **V-9** | **NEGATIVE/ABUSE.** Destroying one instance mid-run must not disturb another; a theme change after a destroy must not throw; two instances with different seeds must not share an `rng`; a destroy during a context-wide repaint must not throw. | Each traced and executed. **A single violation blocks regardless of everything else.** |
| **V-10** | a11y is preserved, not re-created. | Real DOM underneath; canvases `aria-hidden`; the masthead is still an `<h1>`. |

## 5. Phasing

- **P0 — Golden-frame harness.** *No source changes.* Build the oracle before touching a line (§6).
- **P1 — Core.** Fields, plates, the 4→1 draw collapse, `press()`, per-instance config, lazy browser globals.
- **P2 — Rebuild the docs on the core.** The dogfood *and* the proof. **Gated on V-4.** Note the leverage: all 88 sections already funnel through those 4 draw sites, so a correct core lights them all up at once. The 133 DOM-scan sites — not the section count — are the real porting cost.
- **P3 — React/Next adapter.** `Surface`/`Text`/`Image`, then `Button`/`Meter`/`Card`, then charts over `d3-scale`/`d3-shape`.
- **P4 — Vue adapter** over the same core (the port their architecture forced; ours shouldn't).
- **P5 — `halftone-kit/` folder + degit quickstart + README.**

## 6. The golden-frame oracle (why this is a refactor, not a rewrite)

R14 proved two things that make this extraction *verifiable* rather than hopeful: a canvas hash catches pixel-level regressions, and the settled frame is a **bit-exact invariant** (old and new builds both hashed `d94d0b6e` / 267682 bytes at defaults).

Apply it to the extraction: **hash every docs surface before, rebuild on the core, require byte-identical after.** That converts "did we break the look?" from taste into a command that fails.

Three traps, all learned the hard way — see `halftone-splice-and-gates` memory:
1. **Equal readback counts on both sides.** Repeated `getImageData` drops Chrome off GPU backing and re-rasterises; unequal readbacks report phantom differences.
2. **Equalise `localStorage`.** Two localhost ports are two origins and share nothing; leftover grain dials made two identical builds look 40% different.
3. **Record the config with every hash**, or the number is unreproducible across sessions.

## 7. Risks

- **The bespoke chart draws are where pixel-exactness will break first.** They predate the funnel and have already diverged once (R12c: `GRAIN.ink` reached neither). Expect P1's collapse to fight them; V-4 is what will catch it.
- **Lazy color resolution is load-bearing** and easy to flatten by accident during extraction — that would silently kill theming and the harmony pass.
- **R14's open roll question interacts with V-4.** If a seed comes to drive angle/pitch/jitter, "one correct resting frame" stops being true and the oracle needs per-seed goldens. **Settle that before P1**, not during.
- **`press()` is a new public API** — cheap to get wrong, expensive to change after people `degit` it into their repos. It should get a Liotta pass before P1, not after.
