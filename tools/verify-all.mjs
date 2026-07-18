// Runs every verification harness sequentially (fast-to-slow) and exits non-zero if any fails.
// Sequential, not parallel: the Chromium-backed harnesses (react-visual, vue-visual, studio, golden)
// contend for the same GPU/CPU-bound rendering resources if run concurrently.
//
// Run: node tools/verify-all.mjs             (everything, incl. golden — ~5 min)
//      node tools/verify-all.mjs --no-golden  (skip golden — local quick loop, ~2 min)

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const skipGolden = args.includes('--no-golden');

const suites = [
  { name: 'charts', script: 'verify-charts.mjs' },
  { name: 'core', script: 'verify-core.mjs' },
  { name: 'plates', script: 'verify-plates.mjs' },
  { name: 'react', script: 'verify-react.mjs' },
  { name: 'vue', script: 'verify-vue.mjs' },
  { name: 'react-visual', script: 'verify-react-visual.mjs' },
  { name: 'vue-visual', script: 'verify-vue-visual.mjs' },
  { name: 'studio', script: 'verify-studio.mjs' },
];
if (!skipGolden) {
  suites.push({ name: 'golden', script: 'golden-frames.mjs', args: ['--check'] });
}

const results = [];
for (const suite of suites) {
  const scriptPath = path.join(HERE, suite.script);
  console.log(`\n--- ${suite.name} (${suite.script}) ---`);
  const { status } = spawnSync(process.execPath, [scriptPath, ...(suite.args ?? [])], { stdio: 'inherit' });
  const ok = status === 0;
  results.push({ name: suite.name, ok });
  if (!ok) {
    console.log(`\nFAIL  ${suite.name}  — exit ${status}`);
  }
}

console.log('\n=== verify-all summary ===');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`\n${results.length - failed.length}/${results.length} suites passed, ${failed.length} failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} suites passed.`);
  process.exit(0);
}
