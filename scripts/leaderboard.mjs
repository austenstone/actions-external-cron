import { readFileSync } from 'node:fs';

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

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error('Usage: node scripts/leaderboard.mjs <runs.ndjson>');
  process.exit(1);
}

const runs = readFileSync(inputPath, 'utf8')
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

if (runs.length === 0) {
  console.log('# Results\n\nNo runs recorded yet. Give it a few hours.\n');
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
      reliability: slotsCovered / expectedSlots,
      p50: percentile(drifts, 0.5),
      p90: percentile(drifts, 0.9),
      worst: drifts.at(-1),
      failed: sourceRuns.filter((run) => run.conclusion === 'failure').length,
    };
  })
  .sort((a, b) => a.p50 - b.p50);

const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

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
        `| \`${row.source}\` | ${row.runs} | ${(row.reliability * 100).toFixed(1)}% ` +
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
    '',
    `<sub>Generated ${new Date().toISOString()} by \`scripts/leaderboard.mjs\`. ` +
      `Runs drifting more than ${ASSUMPTION_WINDOW_MS / 60_000} minutes are excluded — ` +
      'their slot cannot be inferred reliably.</sub>',
    '',
  ].join('\n'),
);
