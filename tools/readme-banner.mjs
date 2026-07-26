// Generates the README's animated SVG assets (banner + hero, dark/light) into assets/.
// SMIL animation only — GitHub's sanitizer strips <style>/<script> from SVGs, but
// <animate>/<animateTransform> survive inside <img>. Deterministic: same seed, same bytes.
//
//   node tools/readme-banner.mjs
//
// Bump the _vN suffix in OUT on any visual change — GitHub's camo cache holds old
// renders for hours, so the filename is the cache-buster (see assets in README.md).

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = 'v1'
const OUT = {
  bannerDark: `assets/banner-dark_${VERSION}.svg`,
  bannerLight: `assets/banner-light_${VERSION}.svg`,
  heroDark: `assets/hero-press-dark_${VERSION}.svg`,
  heroLight: `assets/hero-press-light_${VERSION}.svg`,
}

// mulberry32 — tiny seeded PRNG, deterministic output
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const f = n => +n.toFixed(2)

const THEMES = {
  dark: {
    bgA: '#0f1114', bgB: '#1a1218', border: '#2b2530', grid: '#1d212a', gridOp: 0.55,
    fg: '#f2f0ea', muted: '#a19fa6', accA: '#e58bb4', accB: '#bc4a78',
    pills: [
      { bg: '#2a1620', stroke: '#4a2438', fg: '#e8a7c4' },
      { bg: '#14202e', stroke: '#263a52', fg: '#8fb8e8' },
    ],
    // masthead ink identity: c→blue, m→pink, y→yellow, k→paper-white on dark
    inks: { c: '#6aa1e6', m: '#e07aa7', y: '#d9b13b', k: '#ecebe6' },
    line: '#6aa1e6',
  },
  light: {
    bgA: '#fffdf7', bgB: '#f6ecdf', border: '#e4dbc9', grid: '#efe7d6', gridOp: 1,
    fg: '#1b1d22', muted: '#5a564e', accA: '#bc4a78', accB: '#8c3560',
    pills: [
      { bg: '#f9e4ee', stroke: '#e5b8cd', fg: '#96395f' },
      { bg: '#e7eef8', stroke: '#bfd2ea', fg: '#33568a' },
    ],
    inks: { c: '#3f6fb8', m: '#bc4a78', y: '#b9901f', k: '#23242a' },
    line: '#3f6fb8',
  },
}

// AM screen: rotated-grid dots clipped to a disc, r ∝ √tone — the real thing, in miniature
function rosettePlate(angle, pitch, R, tone) {
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const n = Math.ceil(R / pitch) + 1
  const dots = []
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = (i * cos - j * sin) * pitch
      const y = (i * sin + j * cos) * pitch
      const d = Math.hypot(x, y)
      if (d > R - 1.5) continue
      const r = Math.min(pitch * 0.62, 3.1 * Math.sqrt(tone(d / R)))
      if (r < 0.35) continue
      dots.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`)
    }
  }
  return dots.join('')
}

// the mark: a live four-plate rosette — C/M/Y breathe against a locked K anchor plate
function rosette(t) {
  const tone = u => 0.16 + 0.84 * (1 - u) ** 1.4
  const plates = [
    { ink: t.inks.y, ang: 0, op: 0.85, anim: { v: '0 0;0.9 1.2;-1.1 -0.6;0 0', dur: 17 } },
    { ink: t.inks.c, ang: 0.262, op: 0.85, anim: { v: '0 0;1.5 -1;-0.9 0.7;0 0', dur: 11 } },
    { ink: t.inks.m, ang: 1.309, op: 0.85, anim: { v: '0 0;-1.2 0.9;0.8 -1.1;0 0', dur: 13 } },
    { ink: t.inks.k, ang: 0.785, op: 0.9, anim: null },
  ]
  const gs = plates.map(p => {
    const anim = p.anim
      ? `<animateTransform attributeName="transform" type="translate" values="${p.anim.v}" dur="${p.anim.dur}s" repeatCount="indefinite"/>`
      : ''
    return `<g fill="${p.ink}" fill-opacity="${p.op}">${anim}${rosettePlate(p.ang, 9, 46, tone)}</g>`
  }).join('')
  return `<circle r="50" fill="none" stroke="${t.muted}" stroke-opacity="0.35"/>${gs}`
}

// Catmull-Rom → cubic bezier path through pts
function smoothPath(pts) {
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }
  return d
}

function inkWalk(rand, x0, x1, y0, y1, n) {
  const pts = []
  let y = y0 + (y1 - y0) * 0.75
  for (let i = 0; i < n; i++) {
    const drift = (y0 + (y1 - y0) * (1 - i / (n - 1)) * 0.85 - y) * 0.45
    y += drift + (rand() - 0.5) * (y1 - y0) * 0.34
    y = Math.max(y0, Math.min(y1, y))
    pts.push([x0 + ((x1 - x0) * i) / (n - 1), y])
  }
  return pts
}

// the signature surface: solid ink line, a comet of grain falling away beneath, grain alive
function inkComet(rand, pts, x0, x1, yFloor, color, { step = 7, decay = 26, twinkle = 0.55 }) {
  const yAt = x => {
    let i = 1
    while (i < pts.length - 1 && pts[i][0] < x) i++
    const [xa, ya] = pts[i - 1], [xb, yb] = pts[i]
    const u = (x - xa) / (xb - xa)
    return ya + (yb - ya) * u
  }
  const dots = []
  for (let x = x0; x <= x1; x += step) {
    const top = yAt(x)
    for (let y = top + 4; y < yFloor; y += 5.5 + rand() * 3) {
      const p = Math.exp(-(y - top) / decay)
      if (rand() > p) continue
      const cx = f(x + (rand() - 0.5) * 5), cy = f(y + (rand() - 0.5) * 3)
      const r = f(0.9 + 1.2 * p + rand() * 0.4)
      const o = f(0.25 + 0.65 * p)
      if (rand() < twinkle) {
        const dur = f(2.8 + rand() * 4), begin = f(rand() * 7)
        dots.push(`<circle cx="${cx}" cy="${cy}" r="${r}" opacity="${o}">` +
          `<animate attributeName="opacity" values="${o};${f(o * 0.12)};${o}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/></circle>`)
      } else {
        dots.push(`<circle cx="${cx}" cy="${cy}" r="${r}" opacity="${o}"/>`)
      }
    }
  }
  return `<g fill="${color}">${dots.join('')}</g>` +
    `<path d="${smoothPath(pts)}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`
}

function frame(W, H, t, label) {
  const vlines = [], hlines = []
  for (let x = 160; x < W; x += 160) vlines.push(`M${x} 0 V${H}`)
  for (let y = 60; y < H; y += 60) hlines.push(`M0 ${y} H${W}`)
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${t.bgA}"/><stop offset="1" stop-color="${t.bgB}"/>
</linearGradient>
<linearGradient id="acc" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${t.accA}"/><stop offset="1" stop-color="${t.accB}"/>
</linearGradient>
</defs>
<rect width="${W}" height="${H}" rx="20" fill="url(#bg)"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="19.5" fill="none" stroke="${t.border}" stroke-width="1"/>
<g stroke="${t.grid}" stroke-width="1" opacity="${t.gridOp}"><path d="${hlines.join(' ')}"/><path d="${vlines.join(' ')}"/></g>`
}

function pill(x, text, p) {
  const w = Math.ceil(text.length * 7.2 + 24)
  return {
    w,
    svg: `<g transform="translate(${x} 0)"><rect width="${w}" height="26" rx="13" fill="${p.bg}" stroke="${p.stroke}"/>` +
      `<text x="${w / 2}" y="17.5" font-size="12" font-weight="600" fill="${p.fg}" text-anchor="middle" letter-spacing="0.4">${text}</text></g>`,
  }
}

function banner(t) {
  const label = 'Halftone UI — every surface printed, not painted'
  const p1 = pill(0, 'zero dependencies', t.pills[0])
  const p2 = pill(p1.w + 10, 'no build step', t.pills[1])
  const rand = rng(1859) // the masthead seed
  const pts = inkWalk(rand, 612, 780, 58, 168, 8)
  return `${frame(800, 240, t, label)}
<g transform="translate(96 118)">${rosette(t)}</g>
<g transform="translate(200 0)" font-family="'Segoe UI', Inter, system-ui, -apple-system, sans-serif">
<text x="0" y="112" font-size="58" font-weight="800" letter-spacing="-1.5"><tspan fill="${t.fg}">halftone</tspan><tspan fill="url(#acc)">·ui</tspan></text>
<text x="2" y="148" font-size="19" font-weight="500" fill="${t.muted}" letter-spacing="0.2">Every surface printed, not painted.</text>
<g transform="translate(2 168)">${p1.svg}${p2.svg}</g>
</g>
<g>${inkComet(rand, pts, 612, 780, 208, t.line, { step: 6, decay: 20, twinkle: 0.5 })}</g>
</svg>`
}

function hero(t) {
  const label = 'A pressed line chart — solid ink above, live grain falling away beneath'
  const rand = rng(4178)
  const pts = inkWalk(rand, 48, 752, 62, 200, 16)
  return `${frame(800, 300, t, label)}
<g>${inkComet(rand, pts, 48, 752, 262, t.line, { step: 7, decay: 30, twinkle: 0.55 })}</g>
</svg>`
}

const files = {
  [OUT.bannerDark]: banner(THEMES.dark),
  [OUT.bannerLight]: banner(THEMES.light),
  [OUT.heroDark]: hero(THEMES.dark),
  [OUT.heroLight]: hero(THEMES.light),
}
for (const [rel, svg] of Object.entries(files)) {
  writeFileSync(join(ROOT, rel), svg + '\n')
  console.log(`${rel}  ${(svg.length / 1024).toFixed(1)}KB`)
}

// eyeball loop: python3 -m http.server 8931 (repo root) → /tools/readme-banner-preview.html
const preview = `<!doctype html><meta charset="utf-8"><title>readme banner preview</title>
<body style="margin:0;font-family:system-ui">
${Object.values(OUT).map(p => {
  const dark = p.includes('-dark')
  return `<div style="background:${dark ? '#0d1117' : '#ffffff'};padding:28px;text-align:center"><img src="../${p}" width="720" alt="${p}"></div>`
}).join('\n')}
</body>`
writeFileSync(join(ROOT, 'tools/readme-banner-preview.html'), preview)
console.log('tools/readme-banner-preview.html')
