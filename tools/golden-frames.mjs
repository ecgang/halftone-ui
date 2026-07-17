#!/usr/bin/env node
// Golden-frame oracle for the halftone press.  P0 of plans/halftone-kit-extraction.md.
//
// Hashes every canvas the docs site renders, so the library extraction can be run as a
// REFACTOR WITH A PIXEL-EXACT TEST rather than a rewrite judged by eye: capture the golden
// before touching a line, rebuild the docs on the core, require byte-identical after (V-4).
//
//   node golden-frames.mjs --write      capture and overwrite golden-frames.json
//   node golden-frames.mjs --check      capture and diff against it; exit 1 on any drift
//   node golden-frames.mjs --selftest   capture twice, assert the two agree (proves the oracle)
//
// WHY A FROZEN CLOCK RATHER THAN prefers-reduced-motion
//
// Reduced motion looks like the obvious basis: grainIO is null, so surfaces are born pr=1 and
// pressIn snaps.  It does not work.  Measured 2026-07-17: the reduced-motion render at load is
// NOT reproducible -- identical harness invocations return either 153/172 canvases inked or
// 0/172, decided before the first measurement and unchanged by any wait (0ms..3000ms) or by
// forcing a composite.  Same branch every time (reduced=true, zero canvases carrying _grainS,
// identical scrollHeight, no page errors, canvases correctly sized) -- so the engine takes the
// same path and still sometimes draws nothing.  Two unchanged scripts reproduce opposite
// results on the same machine minutes apart.  The trigger is NOT isolated; do not trust
// reduced-motion-at-load until it is.
//
// So the harness drives the REAL animated path instead, with time frozen and stepped by hand:
// page.clock fakes rAF/performance.now, which is what makes both the press-in run and the
// surface loop's `s.x.t += 0.0045` land on an exact, repeatable frame.  This is strictly better
// than the reduced path anyway -- it pins the frame users actually see.
//
// THREE MORE TRAPS, each learned by being burned:
//  1. EXACTLY ONE readback per canvas.  Repeated getImageData/toDataURL drops Chrome off its
//     GPU backing and the CPU rasteriser anti-aliases the same arcs differently, so an A/B at
//     unequal readback counts reports a phantom difference.  One toDataURL each, one pass.
//  2. localStorage is cleared before ANY page script runs (addInitScript beats the head
//     anti-FOUC block at docs/index.html:611).  Leftover grain dials once made two identical
//     builds look 40% apart.  Only stipple-mode is set; hue/grain/lang stay at source defaults.
//  3. The config is recorded INTO the golden.  A hash without its config is unreproducible --
//     the same invariant has already been recorded twice at different grain settings, with
//     neither number wrong.
//
// SCOPE.  Hashes are only comparable within one Chromium build on one platform (rasterisation
// is not portable), so --check warns loudly when meta.browser drifts.

import http from 'node:http'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const GOLDEN = path.join(HERE, 'golden-frames.json')

// Everything that can move a pixel. Recorded into the golden verbatim; --check compares it.
const CONFIG = {
  page: '/docs/index.html',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1, // engine clamps: Math.min(devicePixelRatio || 1, 2)
  reducedMotion: 'no-preference', // deliberate: see header. The real path, not the side door.
  clock: 'installed at t=0; advanced only via runFor()',
  scrollStep: 700, // must be < viewport height so no canvas is skipped by grainIO
  scrollTickMs: 60, // let each intersection's press-in start
  settleMs: 4000, // >> the 1500ms masthead press; drives every run to pr === 1
  dialogPressMs: 1600, // per opened dialog/drawer: > its inner buttons' 700ms press-in
  modes: ['dark', 'light'], // both: lazy colour resolution is what extraction is likeliest to flatten
  seed: 1859, // source constant, not persisted -- listed so a change to it shows up here
  storage: 'cleared; then stipple-mode=<mode>. hue/grain/lang left at source defaults.',
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

// file:// is blocked for canvas readback, so the harness serves the repo itself rather than
// depending on a stray `python3 -m http.server` that may be on a different origin -- and so a
// different localStorage -- than the one the golden was captured on.
function serve(root) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0])
      if (rel.endsWith('/')) rel += 'index.html'
      const file = path.join(root, rel)
      if (!file.startsWith(root)) return res.writeHead(403).end('forbidden')
      try {
        const st = await stat(file)
        if (st.isDirectory()) return res.writeHead(302, { location: rel + '/' }).end()
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
        createReadStream(file).pipe(res)
      } catch {
        res.writeHead(404).end('not found')
      }
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

// Runs in the page. Keyed by nearest ancestor section id + index within it: only 18 of the 150
// canvases in markup carry an id (172 exist at runtime), and raw document order would renumber
// everything the moment a section gains a canvas. 2 canvases (the masthead) precede any section.
function readAllCanvases() {
  const seen = new Map()
  const out = []
  for (const cv of document.querySelectorAll('canvas')) {
    const sec = cv.closest('section[id]')
    const base = sec ? sec.id : '~doc'
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    const r = cv.getBoundingClientRect()
    // checkVisibility() is NOT a readback (no pixel access), so it does not poison the hash.
    // A hidden canvas is still hashed (its blank backing store) but flagged so --write can
    // disclose it: a rendering regression INSIDE a canvas that is hidden on both sides would
    // otherwise stay masked. Dialogs/drawers are opened before this runs; what stays hidden
    // here is the genuinely-never-shown remainder (orphan templates).
    const vis = cv.checkVisibility ? cv.checkVisibility() : r.width > 0
    let url
    try {
      url = cv.toDataURL() // THE ONE readback. Do not add another.
    } catch (e) {
      url = 'ERR:' + e.message
    }
    out.push({ key: `${base}[${n}]`, id: cv.id || null, w: cv.width, h: cv.height, cssW: Math.round(r.width), cssH: Math.round(r.height), vis, url })
  }
  return out
}

async function capture() {
  const server = await serve(ROOT)
  const { port } = server.address()
  const browser = await chromium.launch()
  const frames = {}
  const problems = []
  const notes = []
  try {
    for (const mode of CONFIG.modes) {
      const ctx = await browser.newContext({
        viewport: CONFIG.viewport,
        deviceScaleFactor: CONFIG.deviceScaleFactor,
        reducedMotion: CONFIG.reducedMotion,
      })
      // Beats the head anti-FOUC block (docs/index.html:611), which reads storage during parse.
      await ctx.addInitScript((m) => {
        try {
          localStorage.clear()
          localStorage.setItem('stipple-mode', m)
        } catch {}
      }, mode)

      const page = await ctx.newPage()
      page.on('pageerror', (e) => problems.push(`[${mode}] pageerror: ${e.message.split('\n')[0]}`))
      page.on('console', (m) => m.type() === 'error' && problems.push(`[${mode}] console: ${m.text().slice(0, 120)}`))

      await page.clock.install({ time: 0 })
      await page.goto(`http://127.0.0.1:${port}${CONFIG.page}`, { waitUntil: 'load' })

      // grainIO holds every surface at pr = 0 until it scrolls into view, so an unscrolled page
      // hashes two-thirds blank. Walk the whole document to fire every observer, then wind the
      // clock forward far enough that every press-in has landed on pr === 1.
      const docH = await page.evaluate(() => document.documentElement.scrollHeight)
      for (let y = 0; y < docH; y += CONFIG.scrollStep) {
        await page.evaluate((v) => scrollTo(0, v), y)
        await page.clock.runFor(CONFIG.scrollTickMs)
      }
      await page.evaluate(() => scrollTo(0, 0))
      await page.clock.runFor(CONFIG.settleMs)

      // Open every dialog/drawer so its inner canvases render into a hashable state. A closed
      // dialog's canvases are blank on BOTH sides (golden and check), so a rendering regression
      // inside one would be masked -- the exact false-PASS Codex flagged. The open handler
      // (docs/index.html:4392) synchronously rebuilds+draws the canvases it contains; grainIO
      // then presses them in, and the clock winds that to pr === 1. Order is document order,
      // deterministic. Left open through readback -- closing would blank them again.
      const dlgIds = await page.evaluate(() => [...document.querySelectorAll('[data-dlg]')].map((b) => b.dataset.dlg))
      for (const id of dlgIds) {
        await page.evaluate((i) => document.querySelector(`[data-dlg="${i}"]`)?.click(), id)
        await page.clock.runFor(CONFIG.dialogPressMs)
      }

      // Assert the environment took, rather than trusting the flags: a silently un-frozen clock
      // or an unfired observer would mean hashing a moving target and calling it a golden.
      const env = await page.evaluate(() => {
        const all = [...document.querySelectorAll('canvas')]
        // A canvas inside a closed dialog/drawer never intersects, so grainIO never fires and it
        // rests at pr = 0 forever. That is correct -- it has not been shown yet -- and it hashes
        // blank deterministically. Only a VISIBLE canvas short of pr === 1 is a real problem.
        // checkVisibility() rather than offsetParent: the latter is null for position:fixed too.
        const vis = (c) => (c.checkVisibility ? c.checkVisibility() : c.getBoundingClientRect().width > 0)
        return {
          mode: document.documentElement.dataset.mode,
          observed: all.filter((c) => c._grainS).length,
          // A VISIBLE canvas short of pr === 1 means the clock didn't wind far enough -- fatal.
          unsettled: all.filter((c) => c._grainS && c._grainS.x.pr !== 1 && vis(c)).length,
        }
      })
      if (env.mode !== mode) problems.push(`[${mode}] data-mode is "${env.mode}", expected "${mode}"`)
      if (env.unsettled) problems.push(`[${mode}] ${env.unsettled} VISIBLE canvas(es) still mid-press (pr !== 1) -- settle/dialog clock too low`)
      if (!env.observed) problems.push(`[${mode}] no canvas carries _grainS -- grainIO never ran; frames are not trustworthy`)

      // Freeze the perpetual-drift surfaces (loop:true — #wash gradient :3240, the pulse/progress/
      // spinner) to a deterministic frame. They NEVER settle: s.x.t += 0.0045 per rAF forever, so
      // their hash is an arbitrary drift frame whose value depends on the exact fake-clock tick
      // count — reproducible only by luck. A live rAF handle (s.raf) is exactly what marks a
      // looper; non-loopers never set it. Pin t to 2.5 (the same value s.start() gives every
      // non-looping surface) and redraw once, so a golden pins a fixed frame instead of a moving one.
      const froze = await page.evaluate(() => {
        let n = 0
        for (const cv of document.querySelectorAll('canvas')) {
          const s = cv._grainS
          if (s && s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; s.x.t = 2.5; s.draw(); n++ }
        }
        return n
      })

      const shots = await page.evaluate(readAllCanvases)
      frames[mode] = {}
      const hidden = []
      for (const s of shots) {
        if (frames[mode][s.key]) problems.push(`[${mode}] duplicate key ${s.key} -- keying scheme is broken`)
        if (s.url.startsWith('ERR:')) problems.push(`[${mode}] ${s.key}: ${s.url}`)
        if (!s.vis) hidden.push(s.key)
        const payload = s.url.slice(s.url.indexOf(',') + 1)
        frames[mode][s.key] = {
          id: s.id,
          w: s.w,
          h: s.h,
          cssW: s.cssW,
          cssH: s.cssH,
          vis: s.vis,
          bytes: payload.length,
          hash: createHash('sha256').update(s.url).digest('hex').slice(0, 16),
        }
      }
      // Honest disclosure, not silent coverage: these were hidden at capture, so their hash is
      // an unrendered backing store. A regression that only shows inside them is NOT caught.
      // After dialogs are opened this is just orphan templates; recorded so the gap is visible
      // and so a canvas entering/leaving the hidden set between golden and check is diffable.
      notes.push(`[${mode}] ${shots.length} canvases · ${shots.length - hidden.length} rendered · ${froze} loopers frozen · ${hidden.length} hidden (hash is unrendered): ${hidden.join(', ') || 'none'}`)
      await ctx.close()
    }
    return {
      meta: {
        capturedAt: new Date().toISOString(),
        browser: `chromium ${browser.version()}`,
        platform: `${process.platform} ${process.arch}`,
        node: process.version,
      },
      config: CONFIG,
      frames,
      problems,
      notes,
    }
  } finally {
    await browser.close()
    server.close()
  }
}

// How much is this oracle actually discriminating? If most canvases share one hash they are
// blank and the harness proves nothing while reporting green.
function summarise(run) {
  for (const mode of CONFIG.modes) {
    const rows = Object.values(run.frames[mode] || {})
    const distinct = new Set(rows.map((r) => r.hash)).size
    console.log(`  ${mode.padEnd(5)} ${String(rows.length).padStart(3)} canvases · ${String(distinct).padStart(3)} distinct hashes`)
  }
  const d = run.frames.dark, l = run.frames.light
  if (d && l) {
    const keys = Object.keys(d).filter((k) => l[k])
    const same = keys.filter((k) => d[k].hash === l[k].hash).length
    console.log(`  themes: ${keys.length - same}/${keys.length} canvases differ between dark and light`)
  }
  ;(run.notes || []).forEach((n) => console.log(`  · ${n}`))
}

// Any recorded problem makes a run non-authoritative: matching hashes on a half-rendered or
// mid-press page is a FALSE pass. Print and report whether the run may be trusted at all.
function trustworthy(run, label) {
  if (!run.problems.length) return true
  console.log(`\n${label} has ${run.problems.length} problem(s) — verdict is NOT trustworthy:`)
  run.problems.forEach((p) => console.log(`  ! ${p}`))
  return false
}

function diff(a, b) {
  const out = []
  for (const mode of CONFIG.modes) {
    const A = a.frames[mode] || {}, B = b.frames[mode] || {}
    for (const k of Object.keys(A)) {
      if (!(k in B)) out.push(`- ${mode} ${k}: MISSING`)
      else if (A[k].hash !== B[k].hash) {
        const dim = A[k].w !== B[k].w || A[k].h !== B[k].h ? ` [${A[k].w}x${A[k].h} -> ${B[k].w}x${B[k].h}]` : ''
        // A hash moves on any AA nudge; a big swing in bytes means a different render config.
        const pct = A[k].bytes ? Math.round(((B[k].bytes - A[k].bytes) / A[k].bytes) * 100) : 0
        out.push(`~ ${mode} ${k}: ${A[k].hash} -> ${B[k].hash}${dim} (bytes ${pct >= 0 ? '+' : ''}${pct}%)`)
      }
    }
    for (const k of Object.keys(B)) if (!(k in A)) out.push(`+ ${mode} ${k}: NEW`)
  }
  return out
}

const argv = process.argv.slice(2)
const mode = argv.find((a) => a.startsWith('--'))?.slice(2) || 'check'

if (mode === 'write') {
  const run = await capture()
  console.log('captured:')
  summarise(run)
  // Never persist a golden from a run with problems -- it would poison every later --check.
  if (!trustworthy(run, 'this capture')) {
    console.log('\nREFUSED — not writing a golden from an untrustworthy capture. Fix the problems and re-run.')
    process.exit(1)
  }
  await writeFile(GOLDEN, JSON.stringify(run, null, 2) + '\n')
  console.log(`\nwrote ${path.relative(ROOT, GOLDEN)} (${run.meta.browser}, ${run.meta.platform})`)
} else if (mode === 'selftest') {
  // The P0 acceptance test: an oracle that cannot reproduce ITSELF cannot judge anything else.
  console.log('run 1:')
  const a = await capture()
  summarise(a)
  console.log('run 2:')
  const b = await capture()
  summarise(b)
  // Two identically-broken captures agree on every hash -- that is a false STABLE. Problems
  // in either run disqualify the verdict before the diff is even consulted.
  const ok = [trustworthy(a, 'run 1'), trustworthy(b, 'run 2')].every(Boolean)
  const d = diff(a, b)
  if (!ok) {
    console.log('\nINCONCLUSIVE — a capture had problems; stability is not meaningful until they are fixed.')
    process.exit(1)
  }
  if (d.length) {
    console.log(`\nUNSTABLE — ${d.length} canvas(es) differ between two identical runs:`)
    d.slice(0, 20).forEach((l) => console.log('  ' + l))
    process.exit(1)
  }
  console.log('\nSTABLE — two independent captures agree on every canvas in every mode.')
} else {
  let golden
  try {
    golden = JSON.parse(await readFile(GOLDEN, 'utf8'))
  } catch {
    console.error(`no golden at ${path.relative(ROOT, GOLDEN)} — run --write first (on the build you want to freeze).`)
    process.exit(2)
  }
  const run = await capture()
  console.log('captured:')
  summarise(run)
  // Fail closed on anything that makes the comparison unsound, BEFORE trusting a hash match.
  // A poisoned golden, an untrustworthy fresh capture, or non-portable rasterisation (a
  // different browser/platform) can all produce a byte-match that means nothing.
  if (golden.problems && golden.problems.length) {
    console.log(`\nFAIL — the golden itself was captured with ${golden.problems.length} problem(s); it is not a valid baseline. Re-run --write on a clean build.`)
    process.exit(1)
  }
  if (!trustworthy(run, 'this capture')) {
    console.log('\nFAIL — capture is untrustworthy; a hash match would be a false PASS.')
    process.exit(1)
  }
  if (golden.meta.browser !== run.meta.browser || golden.meta.platform !== run.meta.platform) {
    console.log(`\nFAIL — BROWSER/PLATFORM DRIFT. golden: ${golden.meta.browser} on ${golden.meta.platform}; now: ${run.meta.browser} on ${run.meta.platform}.`)
    console.log('Rasterisation is not portable across builds, so a match here is unsupported. Re-capture the golden on this machine (--write) to compare.')
    process.exit(1)
  }
  if (JSON.stringify(golden.config) !== JSON.stringify(run.config)) {
    console.log('\nFAIL — CONFIG DRIFT — the golden was captured under different settings; hashes are not comparable.')
    process.exit(1)
  }
  const d = diff(golden, run)
  if (d.length) {
    console.log(`\nFAIL — ${d.length} canvas(es) drifted from the golden:`)
    d.forEach((l) => console.log('  ' + l))
    process.exit(1)
  }
  console.log('\nPASS — every canvas is byte-identical to the golden.')
}
