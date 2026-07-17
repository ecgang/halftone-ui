# Spec — `halftone-kit`: extracting the press into a usable library

**Status:** approved to spec (Eric, 2026-07-17). P0 built (`fa537d9`). P1+ not yet approved to build.
**Decisions taken:** React/Next adapter first (Vue second) · folder-via-degit distribution (shadcn model) · v1 scope = press primitive + Surface/Text/Image + chrome + charts · Liotta pass done and folded in (2026-07-17) · roll/seed resolved (seed = transient only; `roll` = opt-in resting entropy).

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

**Everything is a tone field.** `field(u, v) => number` in `0..1`, where **`u, v` are normalized `[0,1]²`, NOT device pixels** (Liotta, highest-leverage fix). §4a's own plate weight is already `w(u, v)` on normalized coords (`pl.w(p.x/W, p.y/H)` :4932); the public field must match, or every field author's math breaks at retina/4K and no one can write a size-portable field — the whole point of a copy-in lib used at unknown sizes. Text (`textField` :3048), photo luminance, chart geometry, SDF marks are *already* this internally; the engine just doesn't say so. Make it the public contract.

**The scalar callback is the authoring default, with an optional escalation for the hot path.** Screens sample at *cell centers* (O(area/pitch²)), so a scalar closure is fine for a normal canvas — but it cliffs at retina/4K (dpr² × area/pitch² ≈ ~1M calls/frame under `animate:true`), on per-cell photo re-sampling, and across many simultaneous entrance animations. So `field` accepts either a scalar or a descriptor — retrofitting a bulk path *after* the single `drawPress` site exists means touching that site (and the goldens) again, so it lands in P1, not later:

```js
field: (u, v) => 0..1                 // scalar — REQUIRED, the authoring default
// OR an escalation descriptor:
field: {
  sample: (u, v) => 0..1,             // scalar fallback
  sampleInto?: (out, us, vs),         // bulk typed-array fill — one sequential pass, no per-cell dispatch
  resolution?: number,                // "smooth below this" → sample coarse + interpolate (washes/waves/charts)
  bounds?: [u0, v0, u1, v1],          // non-zero region; charts skip the empty rectangle
}
```

**A plate is `{ ink, ang, dx, dy, w(u, v) }`.** This abstraction **already exists** — the masthead's plates carry a per-plate weight function (`:4866–4869`, consumed at `pl.w(p.x/W, p.y/H)` :4932). The area chart "stacks 4 screens by depth" and the bar chart "encodes value twice" are *the same idea, hand-written twice*. Expressing them as plate weights is what collapses **4 draw paths → 1**. **`w(u, v)` MUST be a pure scalar `0..1`** — no `ctx`, no screen branch, no drawing (V-5b). Otherwise bespoke draw logic migrates *into* plate weights and blocker 3 returns as data while V-5's static site-count still reads 1:

```js
drawPress(ctx, { pts, field, plates, screen, grain, pr })
```

Every existing draw becomes one call with different plates and a different field. Blocker 3 dies, and with it the "teach every new screen three times" tax.

### 4b. The public API

```js
import { press, resolvePress, mount, createPressContext } from './halftone-kit/core'

const p = press(canvasEl, {
  field,                    // (u,v) => 0..1   — REQUIRED, normalized; see §4a
  screen: 'hatch',          // stipple | lines | waves | hatch | am
  scale: 1, ink: 1, wash: 1,
  seed: 1859,               // ENTRANCE transient only — never resting geometry (see below + §7)
  roll: 0,                  // resting-geometry entropy; default constant → resting frame is seed-invariant
  inks: ['blue', 'orange'], // omit → mono
  plates,                   // optional explicit plates (masthead / charts); w(u,v) pure, see §4a
  animate: true,            // press-in when scrolled into view
  harmony: true,            // per-instance, scoped to THIS instance's inks
})

p.draw(); p.rebuild(); p.set({ ink: 1.4 }); p.proof(); p.destroy()
```

- **Split config resolution from lifecycle** (Liotta #3). `press(el, opts, ctx?)` is the ergonomic default, but under it live two exported halves: `resolvePress(opts, ctx) → spec` is **pure — no DOM, serializable** (the three-tier merge becomes unit-testable in Node with no canvas, and the golden oracle hashes `spec → pixels`); `mount(el, spec) → handle` owns the rAF/observer/bus. This also makes the SSR pure/impure boundary a named function, not a convention.
- **Transition semantics are the contract** for a copy-in API — specify, don't leave implied: `set(patch)` = merge opts + mark dirty; `draw()` = paint the current spec; `rebuild()` = recompute plate/field cache, then draw; `proof()` = one flattened high-dpi export frame (**define for v1 or cut it from the public surface — do not ship it undefined**); `destroy()` = release rAF (via the generation token), observer, and bus subscription. **The caller owns the lifecycle** — `destroy()` kills blockers 1 and 5 simultaneously.
- **Config resolution: instance opts → context defaults → built-ins.** Resolve **structure eagerly** (which tier wins, at `resolvePress` time); keep **color values lazy** (getters resolved at draw, `tuneInk`/`tuneMix` in the same pass). `createPressContext({ scale, ink, theme, seed, persist })` replaces every global; `<HalftoneProvider>` wraps it for React. Blocker 2 dies.
- **`registry` becomes a per-context `Set`**, and `destroy()` removes from it.
- **Nothing browser-touching at import.** `reduced` and the observer are resolved lazily on first mount. `press()` requires an element, which implies a browser — so the *import* stays pure. Blocker 4 dies.
- **Colors must stay lazy AND close over `ctx`, never a module global** (V-11 — the single most dangerous line in the extraction). `() => ctx.pal().blue`, not `() => PAL.blue`: a getter closing over a module-scope `PAL` populated at import from `matchMedia` breaks SSR (blocker 4), per-instance theming (blocker 2), and lazy color *all at once*. The *selection* of an ink is frozen at resolve time; its *value* is a `ctx`-bound getter resolved at draw.

### 4c. Verifier Contract (§4b) — falsifiable, default-to-fail

| ID | Criterion | How it's checked |
|---|---|---|
| **V-1** | Two `press()` instances on one page with different `scale`/`screen`/`seed` each render per their own config; neither mutates the other. | Two canvases, differing opts, hash both; assert both differ from each other *and* each matches its solo-rendered hash. |
| **V-2** | Mount→destroy ×100 leaves no growth. | `ctx.size` returns to baseline; 0 live rAF; 0 connected observers. |
| **V-3** | Import is SSR-safe. | `node -e "import('./halftone-kit/core')"` with no `window`/`document`/`matchMedia` → no throw. |
| **V-4** | **GOLDEN FRAME — every docs canvas is byte-identical pre- vs post-extraction.** | Canvas hash at matched dpr/seed/config, **equal readback counts on both sides**, **`localStorage` cleared on both origins**, config recorded alongside each hash. (See §6 — this is the load-bearing one.) |
| **V-5** | Exactly **one** tone→radius draw site in core. | Static count == 1 (today: 4 — 3148/3492/3602/4932). |
| **V-5b** | Plate weight `w` is a pure scalar. | `w(u, v)` receives `(u, v)` only — no `ctx` param, no `screen` branch, no `ctx.`/draw call in its body. Static-checkable. Shuts the door that revives blocker 3 as data. |
| **V-6** | Core has 0 framework imports and 0 runtime deps. | Dependency graph of `core/`. Charts may take `d3-scale`/`d3-shape`; core may not. |
| **V-7** | `destroy()` during an in-flight press run leaves no live rAF. | Generation token honored; assert callback count stops. |
| **V-8** | Core makes **zero** DOM lookups. | `getElementById|querySelector|querySelectorAll` in `core/` == 0 (today: 133). |
| **V-9** | **NEGATIVE/ABUSE.** Destroying one instance mid-run must not disturb another; a theme change after a destroy must not throw; two instances with different seeds must not share an `rng`; a destroy during a context-wide repaint must not throw. | Each traced and executed. **A single violation blocks regardless of everything else.** |
| **V-10** | a11y is preserved, not re-created. | Real DOM underneath; canvases `aria-hidden`; the masthead is still an `<h1>`. |
| **V-11** | No color getter closes over a module-scope binding. | Every ink getter references `ctx.` only, never a module `const`/`let`. Static-checkable; it's the one invariant whose violation co-regresses blockers 2 + 4 + theming silently. |
| **V-12** | `harmony` is per-instance. | Two instances with different `inks` and `harmony:true` do not interfere; the harmony pass reads only its own instance's `inks` (a scoped case of V-9). |

## 5. Phasing

- **P0 — Golden-frame harness. ✅ DONE (`fa537d9`).** `tools/golden-frames.mjs` + `golden-frames.json`; no source changes. Hashes 172 canvases × 2 themes; verified stable · sensitive (seed 1859→1860 fails 276/344 rows) · recoverable. Drives the real animated path with `page.clock` frozen — **not** `prefers-reduced-motion`, whose render at load proved nondeterministic. `--write` / `--check` / `--selftest`.
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
- **~~R14's open roll question~~ — RESOLVED (Liotta, 2026-07-17).** `seed` drives the **entrance transient only**; resting geometry stays seed-invariant in v1, so V-4 stays O(configs) rather than O(configs × unbounded seeds) — the golden oracle is the only mechanical regression gate and this protects it. The product option ("each press settles to a visibly different mark") is preserved as a non-breaking seam: a separate **`roll`** input, default constant, feeds any resting-geometry jitter; set `roll: seed` per-instance to opt in, and only those instances need per-seed goldens. P0's negative control already confirmed a new seed leaves the masthead byte-identical, so this matches shipped behavior. `roll` must be in scope for the 4→1 collapse and the plate `w` functions, so it lands in P1, not after.
- **~~`press()` should get a Liotta pass before P1~~ — DONE (2026-07-17).** Its findings are folded into §4a/§4b/§4c above: normalized field coords + escalation descriptor, `resolvePress`/`mount` split, `roll`, V-5b, V-11, V-12, and defined transition semantics. Liotta's verdict on the primitive itself: the imperative handle, the two collapsing ideas, and destroy-owns-lifecycle are all correct — keep them.
