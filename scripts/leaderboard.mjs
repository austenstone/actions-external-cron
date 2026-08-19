import { readFileSync, writeFileSync } from 'node:fs';

const HOUR_MS = 3_600_000;
const ASSUMPTION_WINDOW_MS = HOUR_MS / 2;

const nearestHour = (date) => new Date(Math.round(date.getTime() / HOUR_MS) * HOUR_MS);

const percentile = (sorted, p) =>
  sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];

const format = (ms) => {
  if (ms === null || ms === undefined) return '—';
  const total = Math.abs(ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = ((total % 60_000) / 1000).toFixed(1);
  return `${ms < 0 ? '-' : ''}${minutes > 0 ? `${minutes}m ` : ''}${seconds}s`;
};

const args = process.argv.slice(2);
const jsonFlagIndex = args.indexOf('--json');
const jsonPath = jsonFlagIndex === -1 ? null : args[jsonFlagIndex + 1];
if (jsonFlagIndex !== -1) {
  args.splice(jsonFlagIndex, jsonPath ? 2 : 1);
}

const [inputPath] = args;
if (!inputPath) {
  console.error('Usage: node scripts/leaderboard.mjs <runs.ndjson> [--json <path>]');
  process.exit(1);
}

if (jsonFlagIndex !== -1 && !jsonPath) {
  console.error('Missing path for --json');
  process.exit(1);
}

// Only real schedulers rank. Manual smoke tests and ad-hoc dispatches are useful for
// checking the plumbing but they fire whenever a human felt like it, so letting them
// onto the leaderboard produces nonsense like "-18m drift".
const RANKED_SOURCES = new Set([
  'aws-eventbridge',
  'azure-logic-app',
  'cloudflare',
  'deno-deploy',
  'gcp-cloud-scheduler',
  'github-schedule',
  'vercel-cron',
]);

const allRuns = readFileSync(inputPath, 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))
  .filter((run) => run.created_at)
  .map((run) => {
    const createdAt = new Date(run.created_at);
    const slot = nearestHour(createdAt);
    return {
      // run-name carries the source; fall back to the event for anything unlabelled.
      source: run.name?.trim() || run.event,
      slot: slot.getTime(),
      drift: createdAt.getTime() - slot.getTime(),
      conclusion: run.conclusion,
    };
  })
  // Runs beyond the assumption window cannot be attributed to a slot with confidence.
  .filter((run) => Math.abs(run.drift) <= ASSUMPTION_WINDOW_MS);

const runs = allRuns.filter((run) => RANKED_SOURCES.has(run.source));
const ignoredCount = allRuns.length - runs.length;

const MIN_CONFIDENT_RUNS = 12;

const defaultWindow = () => {
  const end = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
  return {
    start: end - 23 * HOUR_MS,
    end,
    slots: 24,
  };
};

const writeJson = (rows, windowStart, windowEnd, expectedSlots) => {
  if (!jsonPath) return;

  const samplesBySource = new Map();
  for (const run of runs) {
    if (!samplesBySource.has(run.source)) samplesBySource.set(run.source, []);
    samplesBySource.get(run.source).push(run);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    repo: process.env.GITHUB_REPOSITORY || 'austenstone/actions-external-cron',
    window: {
      start: new Date(windowStart).toISOString(),
      end: new Date(windowEnd).toISOString(),
      slots: expectedSlots,
    },
    sources: rows.map((row) => ({
      source: row.source,
      runs: row.runs,
      confident: row.confident,
      reliability: row.reliability,
      p50_ms: row.p50,
      p90_ms: row.p90,
      worst_ms: row.worst,
      failed: row.failed,
      is_control: row.source === 'github-schedule',
      samples: [...(samplesBySource.get(row.source) ?? [])]
        .sort((a, b) => a.slot - b.slot)
        .map((sample) => ({
          slot: new Date(sample.slot).toISOString(),
          drift_ms: sample.drift,
          conclusion: sample.conclusion ?? '',
        })),
    })),
  };

  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
};

if (runs.length === 0) {
  const { start, end, slots } = defaultWindow();
  writeJson([], start, end, slots);
  console.log(
    [
      '# Results',
      '',
      'No scheduler runs recorded yet.',
      '',
      ignoredCount > 0
        ? `${ignoredCount} run(s) were ignored because they came from a source that is not ` +
          'a tracked scheduler — manual smoke tests fire whenever a human triggers them, ' +
          'so ranking them would be meaningless.'
        : 'Deploy an example from `examples/` and the first row will appear within the hour.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const slots = runs.map((run) => run.slot);
const windowStart = Math.min(...slots);
const windowEnd = Math.max(...slots);
const expectedSlots = Math.round((windowEnd - windowStart) / HOUR_MS) + 1;

const bySource = new Map();
for (const run of runs) {
  if (!bySource.has(run.source)) bySource.set(run.source, []);
  bySource.get(run.source).push(run);
}

const rows = [...bySource.entries()]
  .map(([source, sourceRuns]) => {
    const drifts = sourceRuns.map((run) => run.drift).sort((a, b) => a - b);
    const slotsCovered = new Set(sourceRuns.map((run) => run.slot)).size;
    return {
      source,
      runs: sourceRuns.length,
      confident: sourceRuns.length >= MIN_CONFIDENT_RUNS,
      reliability: slotsCovered / expectedSlots,
      p50: percentile(drifts, 0.5),
      p90: percentile(drifts, 0.9),
      worst: drifts.at(-1),
      failed: sourceRuns.filter((run) => run.conclusion === 'failure').length,
    };
  })
  .sort((a, b) => Number(b.confident) - Number(a.confident) || a.p50 - b.p50);

const hasLowSample = rows.some((row) => !row.confident);

const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

writeJson(rows, windowStart, windowEnd, expectedSlots);

console.log(
  [
    '# Results',
    '',
    `Observation window: **${iso(windowStart)} → ${iso(windowEnd)} UTC** ` +
      `(${expectedSlots} hourly slots, ${runs.length} runs).`,
    '',
    'Ranked by median total drift — the gap between the cron slot and the moment GitHub',
    'created the run. Lower is better. See [docs/PAYLOAD.md](PAYLOAD.md) for methodology.',
    '',
    '| Scheduler | Runs | Slots hit | Median | p90 | Worst | Failed |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| \`${row.source}\`${row.confident ? '' : ' †'} | ${row.runs} ` +
        `| ${(row.reliability * 100).toFixed(1)}% ` +
        `| ${format(row.p50)} | ${format(row.p90)} | ${format(row.worst)} | ${row.failed} |`,
    ),
    '',
    '## How to read this',
    '',
    '- **Slots hit** is the reliability number and it matters more than the latency columns.',
    '  A scheduler that fires 4 seconds late every single hour beats one that fires instantly',
    '  but silently skips 3% of slots.',
    '- **Median** is the typical experience. **p90** and **Worst** are what wake you up.',
    '- `github-schedule` is the control: GitHub\'s own `schedule:` trigger aiming at the same',
    '  slot. Every other row is only interesting relative to it.',
    ...(hasLowSample
      ? [
          `- † Fewer than ${MIN_CONFIDENT_RUNS} runs. Ranked below everything else and not`,
          '  worth reading yet — one lucky dispatch is not a track record.',
        ]
      : []),
    '',
    `<sub>Generated ${new Date().toISOString()} by \`scripts/leaderboard.mjs\`. ` +
      `Runs drifting more than ${ASSUMPTION_WINDOW_MS / 60_000} minutes are excluded — ` +
      'their slot cannot be inferred reliably.</sub>',
    '',
  ].join('\n'),
);
