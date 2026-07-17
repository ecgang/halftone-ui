<p align="center">
  <img alt="Smudge, the stipple-ui ink imp" src="assets/smudge.jpeg" width="700">
</p>

<h1 align="center">stipple-ui</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/file-1-8a2be2?style=flat-square" alt="Single file">
  <img src="https://img.shields.io/github/stars/ecgang/stipple-ui?style=flat-square" alt="GitHub stars">
</p>

<p align="center"><strong>A component library where every surface is printed, not painted — seeded ink-stipple UI in one self-contained HTML file.</strong></p>

<p align="center">
  <a href="https://ecgang.github.io/stipple-ui/"><b>▶ Open the live demo</b></a>
</p>

---

## About

stipple-ui renders every fill in the interface — buttons, badges, charts, switches, sliders, washes — as a cloud of Poisson-disk-sampled ink dots on a canvas, the way a printing press lays down grain. Nothing is a flat CSS background; everything is *pressed*. Each surface holds a seed, so the grain is deterministic: reload and you get the same ten thousand dots, reroll and the whole page reprints at once.

It's inspired by (and a loving riff on) [dither-ui.com](https://dither-ui.com/) — same docs-site format, different printmaking tradition: stippling and Retratone-style four-plate crosshatch instead of dithering.

## Features

- **~90 documented components** — primitives (switch, slider, OTP field, dialogs, menus, combobox…), charts (line, pie, radar, area, bars, sparkline), full page examples (dashboard, pricing, sign-in flows), and a set of four-plate crosshatch "ink styles"
- **Four grains everywhere** — every pressed example carries a picker in its tab row: re-press it as stipple, lines, waves, or crosshatch, live
- **Real light & dark themes** — a designed print-shop-cream light mode and an archival-black dark mode, not an inversion filter
- **OKLCH hue wheel** — drag a ring in the topbar and every pigment on the page rotates through OKLCH hue space live; neutrals stay neutral
- **Seeded & deterministic** — one seed drives every surface; `reroll` reprints the world
- **Image stippling** — any raster becomes tone: luminance drives the dot field, so photos re-print in the current ink
- **Smudge** 😈 — the resident ink-imp mascot, pressed from the same engine (that's him up top)
- **Zero dependencies, one file** — no build step, no CDN, works from `file://`
- **Accessible** — native elements underneath (`<dialog>`, `<details>`, real inputs), `prefers-reduced-motion` respected

## Gallery

| | |
|---|---|
| ![Line chart in dark mode — a solid ink line with a comet of grain falling away beneath it](assets/line-chart-dark.jpeg) | ![Pie chart in light mode — four stipple plates stacked on one ring](assets/pie-chart-light.jpeg) |
| ![A photo re-printed as ink stipple by the Image primitive](assets/image-primitive.jpeg) | ![Smudge, the ink imp mascot](assets/smudge.jpeg) |

## Quick Start

No install. It's one HTML file.

```bash
git clone https://github.com/ecgang/stipple-ui.git
open stipple-ui/index.html
```

Or just [download `index.html`](https://raw.githubusercontent.com/ecgang/stipple-ui/main/index.html) and double-click it. Everything — engine, docs, demos, themes — is inside.

> [!TIP]
> Try the topbar: `☀ light` toggles the designed light mode, `◐ hue` opens the OKLCH wheel (drag the ring — the whole site rethemes), and `reroll` reprints every surface from a new seed.

## How it works

Every component wraps a `<canvas>`. A `surface()` call gets a **tone function** — `tone(point) → 0..1` density — and fills the canvas with a seeded Poisson-disk dot cloud, keeping only the dots whose threshold passes the local tone. Animation never tweens CSS: state glides a value, every dot re-tests its threshold, and the grain itself is the motion.

The "ink styles" go further: four plates (like CMYK separations) of directional crosshatch, each with its own ink and a little misregistration, stacked into one print.

The theme system stores `{mode, hue}` in `localStorage`, rotates every pigment through OKLCH, and repaints the registry of live surfaces — which is why the hue wheel rethemes charts, buttons, and Smudge alike in real time.

## Vue / React

The docs show every component with Vue and React snippets (`<SButton color="purple">` / `<Button color="purple">`). The single-file demo *is* the source of truth for the engine today; packaged `@stipple-ui/core|vue|react` builds are on the roadmap.

## Credits

- Format and spirit: [dither-ui.com](https://dither-ui.com/)
- Crosshatch inspiration: Texturelabs' Retratone halftone technique
- Engine, docs, and Smudge: built with [Claude Code](https://claude.com/claude-code)

## License

[MIT](LICENSE) © Eric Gang
