#!/usr/bin/env node
// Guards the seam that has broken twice: the `source` slug an example actually
// sends has to be known to BOTH the ranking allowlist and the dashboard label
// map. When they drift you get silent damage — a scheduler quietly missing from
// the leaderboard, or a row rendered as "Gcp Scheduler" by the title-case
// fallback. Neither throws, so only a check like this catches it.
//
// Also validates that scripts/leaderboard.mjs emits every field site/app.js
// reads, so the dashboard can't go blank from a renamed key.
//
// Usage: node scripts/verify-contract.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const notes = [];

const read = (rel) => readFileSync(join(root, rel), 'utf8');

/** Recursively collect example source files, skipping installed dependencies. */
const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.terraform' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tf|bicep|jsonc?|mjs)$/.test(entry)) acc.push(full);
  }
  return acc;
};

// 1. What each example actually sends -----------------------------------------
// Every example builds a client_payload containing `source`. The spellings differ
// by language (JSON, Terraform HCL, Bicep) so match the value, not the syntax.
// The key is `source` in JSON/HCL but `SOURCE` in wrangler.jsonc vars, so match
// the key case-insensitively. The value must stay lowercase — the allowlist and
// label map are keyed on lowercase slugs, so a capitalised one is itself a bug.
const slugPattern = /["']?source["']?\s*[:=]\s*["']([A-Za-z0-9][\w-]*)["']/gi;
const knownSchedulers =
  /^(aws-|azure-|cloudflare|deno|gcp-|vercel|github-schedule)/i;

const emitted = new Map();
for (const file of walk(join(root, 'examples'))) {
  const body = readFileSync(file, 'utf8');
  for (const [, slug] of body.matchAll(slugPattern)) {
    if (!knownSchedulers.test(slug)) continue; // skips terraform provider `source`
    if (slug !== slug.toLowerCase()) {
      failures.push(
        `${file.replace(`${root}/`, '')} sends source "${slug}" with uppercase ` +
          `characters — slugs must be lowercase to match the allowlist and label map.`
      );
      continue;
    }
    if (!emitted.has(slug)) emitted.set(slug, file.replace(`${root}/`, ''));
  }
}

const EXPECTED_EXAMPLE_COUNT = 6;
if (emitted.size < EXPECTED_EXAMPLE_COUNT) {
  failures.push(
    `Only found ${emitted.size} scheduler slugs but examples/ ships ` +
      `${EXPECTED_EXAMPLE_COUNT} — an example stopped sending \`source\`, or the scan missed it.`
  );
}

if (emitted.size === 0) {
  failures.push('Found no `source` slugs in examples/ — the scan pattern is broken.');
} else {
  notes.push(`Found ${emitted.size} scheduler slugs across examples/`);
}

// 2. Cross-check against the ranking allowlist ---------------------------------
const leaderboard = read('scripts/leaderboard.mjs');
const allowBlock = leaderboard.match(/RANKED_SOURCES = new Set\(\[([\s\S]*?)\]\)/);
if (!allowBlock) {
  failures.push('scripts/leaderboard.mjs: could not locate RANKED_SOURCES.');
} else {
  const ranked = new Set([...allowBlock[1].matchAll(/['"]([a-z0-9-]+)['"]/g)].map((m) => m[1]));
  for (const [slug, file] of emitted) {
    if (!ranked.has(slug)) {
      failures.push(
        `${file} sends source "${slug}" but RANKED_SOURCES omits it — ` +
          `that scheduler would be silently dropped from the leaderboard.`
      );
    }
  }
  if (!ranked.has('github-schedule')) {
    failures.push('RANKED_SOURCES is missing "github-schedule" — the control group.');
  }
}

// 3. Cross-check against the dashboard label map --------------------------------
const app = read('site/app.js');
const labelBlock = app.match(/sourceLabels = \{([\s\S]*?)\n {2}\}/);
if (!labelBlock) {
  failures.push('site/app.js: could not locate sourceLabels.');
} else {
  const labelled = new Set(
    [...labelBlock[1].matchAll(/^\s*["']?([a-z0-9-]+)["']?\s*:/gm)].map((m) => m[1])
  );
  for (const [slug, file] of emitted) {
    if (!labelled.has(slug)) {
      failures.push(
        `${file} sends source "${slug}" but site/app.js has no label for it — ` +
          `the dashboard would title-case it into something like "Gcp Scheduler".`
      );
    }
  }
  if (!labelled.has('github-schedule')) {
    failures.push('site/app.js sourceLabels is missing "github-schedule".');
  }
}

// 4. Every class the dashboard renders must actually be styled ------------------
// This bit the SVG charts: app.js emitted <text class="chart-label"> and friends,
// but style.css never defined them. SVG text takes `fill`, not `color`, so the
// unstyled elements fell back to the SVG default of solid black — a 1.11:1
// contrast ratio on the dark background, i.e. invisible. Nothing errored.
const css = read('site/style.css');
const definedClasses = new Set(
  [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])
);

const renderedClasses = new Set();
for (const [, attr] of app.matchAll(/class="([^"$]*)"/g)) {
  for (const name of attr.split(/\s+/).filter(Boolean)) renderedClasses.add(name);
}

for (const name of [...renderedClasses].sort()) {
  if (!definedClasses.has(name)) {
    failures.push(
      `site/app.js renders class "${name}" but site/style.css never defines it — ` +
        `unstyled SVG text falls back to black and disappears on the dark background.`
    );
  }
}
notes.push(`Checked ${renderedClasses.size} rendered classes against style.css`);

// 5. Data contract: does the pipeline emit what the dashboard reads? ------------
// app.js reads fields off each source object; leaderboard.mjs writes them. A
// rename on either side blanks the dashboard without raising an error.
const requiredFields = [
  'source',
  'runs',
  'confident',
  'reliability',
  'p50_ms',
  'p90_ms',
  'worst_ms',
  'failed',
  'is_control',
  'samples'
];

for (const field of requiredFields) {
  const inWriter = new RegExp(`\\b${field}\\b`).test(leaderboard);
  const inReader = new RegExp(`\\b${field}\\b`).test(app);
  if (inWriter && !inReader) {
    failures.push(`Field "${field}" is emitted by leaderboard.mjs but never read by app.js.`);
  }
  if (!inWriter && inReader) {
    failures.push(`Field "${field}" is read by site/app.js but never emitted by leaderboard.mjs.`);
  }
}

// 5. The shipped data.json has to parse and match that shape --------------------
try {
  const data = JSON.parse(read('site/data.json'));
  for (const key of ['generated_at', 'repo', 'window', 'sources']) {
    if (!(key in data)) failures.push(`site/data.json is missing top-level "${key}".`);
  }
  for (const source of data.sources ?? []) {
    for (const field of requiredFields) {
      if (!(field in source)) {
        failures.push(`site/data.json source "${source.source}" is missing "${field}".`);
      }
    }
  }
  notes.push(`site/data.json parses with ${data.sources?.length ?? 0} source(s)`);
} catch (error) {
  failures.push(`site/data.json does not parse: ${error.message}`);
}

// Report ------------------------------------------------------------------------
for (const note of notes) console.log(`  ${note}`);
console.log(`  slugs: ${[...emitted.keys()].sort().join(', ') || '(none)'}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} contract failure(s):\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\nContract OK — examples, leaderboard, and dashboard agree.');
