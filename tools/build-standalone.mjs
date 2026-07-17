// build-standalone — inline the modular core into a self-contained, file://-openable docs artifact.
//
// The docs SOURCE (docs/index.html) imports the real @halftone-kit/core as an ES module — that's the
// dogfood: the docs runs on the exact library code, so a bug in the core shows in the docs and the
// golden catches it. But a module import means a downloaded single file is dead and file:// blocks
// the load (module CORS) — which broke the README's headline promise ("one HTML file… download it,
// everything is inside"). This build reconciles the two: it bundles the module (resolving the core
// imports) into ONE classic <script> IIFE and writes a self-contained dist/index.html. The build is
// on OUR side, so the USER still gets one file, no install. What ships / deploys / is downloaded /
// is golden-hashed is dist/index.html; docs/index.html stays the editable modular source.
//
//   node tools/build-standalone.mjs            # build dist/index.html from docs/index.html
//   node tools/build-standalone.mjs --check    # rebuild in memory, diff vs committed dist -> exit 1 if stale
//
// esbuild does the bundling (behavior-preserving; the golden proves dist renders byte-identical to
// the source). No minify — the artifact stays readable, and readable diffs keep the staleness guard
// honest. Only the <script type="module"> block is transformed; all HTML/CSS/the data: favicon are
// copied verbatim, so nothing but the JS delivery mechanism changes.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'docs', 'index.html');
const OUT = path.join(ROOT, 'dist', 'index.html');
const MODULE_RE = /<script type="module">([\s\S]*?)<\/script>/;

async function buildHtml() {
  const esbuild = (await import('esbuild')).default ?? (await import('esbuild'));
  const src = readFileSync(SRC, 'utf8');

  const matches = src.match(new RegExp(MODULE_RE.source, 'g')) || [];
  if (matches.length !== 1) {
    throw new Error(`expected exactly ONE <script type="module"> in docs/index.html, found ${matches.length}`);
  }
  const inner = src.match(MODULE_RE)[1];

  // Bundle the module as an IIFE. resolveDir = docs/ so `../halftone-kit/core/index.js` resolves.
  const result = await esbuild.build({
    // Pin esbuild's working dir to ROOT so the bundle is CWD-INDEPENDENT: esbuild emits its module-
    // boundary comments (`// halftone-kit/core/rng.js`) relative to absWorkingDir, so a build from
    // the repo root (the CLI) and one from tools/ (the golden's `cd tools && node …` calling
    // checkFresh) produce byte-identical output. Without this the freshness gate false-positives.
    absWorkingDir: ROOT,
    stdin: { contents: inner, resolveDir: path.join(ROOT, 'docs'), loader: 'js', sourcefile: 'docs-module.js' },
    bundle: true,
    format: 'iife',
    target: 'es2020',
    charset: 'utf8',
    legalComments: 'none',
    write: false,
  });
  const iife = result.outputFiles[0].text.replace(/\s+$/, '');

  // Replace ONLY the module <script> with a classic inline one carrying the bundled IIFE.
  const html = src.replace(MODULE_RE, `<script>\n${iife}\n</script>`);
  if (html.includes('type="module"') || /from ['"]\.\.\/halftone-kit/.test(html)) {
    throw new Error('build left a module script or an unresolved core import — not self-contained');
  }
  return html;
}

// checkFresh — is the committed dist/index.html exactly what a fresh build of docs/index.html
// produces? Returns { fresh, reason, bytes }. Exported so the golden can ENFORCE the freshness
// invariant mechanically (hash the shipped bundle only after proving it matches the source),
// rather than trusting a human to remember to rebuild — otherwise golden --check can stay green
// against a stale dist while docs/core moved on.
export async function checkFresh() {
  const html = await buildHtml();
  if (!existsSync(OUT)) return { fresh: false, reason: `${path.relative(ROOT, OUT)} does not exist` };
  if (readFileSync(OUT, 'utf8') !== html) return { fresh: false, reason: `${path.relative(ROOT, OUT)} differs from a fresh build of docs/index.html` };
  return { fresh: true, bytes: html.length };
}

// CLI entry — only when run directly (so `import`ing this module for checkFresh() has no side effects).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--check')) {
    const r = await checkFresh();
    if (!r.fresh) {
      console.error(`STALE — ${r.reason}. Rebuild and commit: node tools/build-standalone.mjs`);
      process.exit(1);
    }
    console.log(`FRESH — ${path.relative(ROOT, OUT)} matches docs/index.html (${r.bytes} bytes).`);
  } else {
    const html = await buildHtml();
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, html);
    console.log(`wrote ${path.relative(ROOT, OUT)} (${html.length} bytes) — self-contained, file://-openable.`);
  }
}
