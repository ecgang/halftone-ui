// Build the Studio into ONE committed, self-contained artifact: studio/index.html. Same pattern as
// verify-react-visual.mjs — esbuild bundles studio/src/app.jsx + react/react-dom into an IIFE
// (react lives in tools/node_modules, hence nodePaths), and the result plus the stylesheet is
// inlined so Vercel serves /studio/ statically with zero config and no root package.json.
//
// Run: node tools/build-studio.mjs

import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'studio', 'src');

const built = await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: [path.join(SRC, 'app.jsx')],
  bundle: true, format: 'iife', target: 'es2020', jsx: 'transform', charset: 'utf8',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
  nodePaths: [path.join(HERE, 'node_modules')], // react/react-dom live in tools/, never at ROOT
});

// `</script>` inside the bundle would terminate the inline tag mid-string; the escaped form is
// identical inside JS string literals and inert in HTML.
const js = built.outputFiles[0].text.replace(/<\/script>/gi, '<\\/script>');
const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');

// Same halftone favicon as the docs page — one identity across the site.
const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23131210'/%3E%3Cg fill='%23E9E5D9'%3E%3Ccircle cx='8' cy='8' r='1.2'/%3E%3Ccircle cx='16' cy='8' r='2.1'/%3E%3Ccircle cx='24' cy='8' r='3'/%3E%3Ccircle cx='8' cy='16' r='2.1'/%3E%3Ccircle cx='16' cy='16' r='3'/%3E%3Ccircle cx='24' cy='16' r='3.8'/%3E%3Ccircle cx='8' cy='24' r='3'/%3E%3Ccircle cx='16' cy='24' r='3.8'/%3E%3Ccircle cx='24' cy='24' r='4.4'/%3E%3C/g%3E%3C/svg%3E";

const html = `<!doctype html>
<html lang="en" data-mode="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${FAVICON}">
<title>Halftone UI — studio</title>
<style>
${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;

const out = path.join(ROOT, 'studio', 'index.html');
fs.writeFileSync(out, html);
console.log(`built ${path.relative(ROOT, out)}  (${(html.length / 1024).toFixed(1)} KB)`);
