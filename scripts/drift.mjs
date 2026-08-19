import { appendFileSync } from 'node:fs';

const HOUR_MS = 3_600_000;

const parse = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Round rather than floor: a scheduler that fires a second early belongs to the slot
// it was aiming at, not the one an hour before. See docs/PAYLOAD.md.
const nearestHour = (date) => new Date(Math.round(date.getTime() / HOUR_MS) * HOUR_MS);

const format = (ms) => {
  if (ms === null) return '—';
  const sign = ms < 0 ? '-' : '';
  const total = Math.abs(ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = ((total % 60_000) / 1000).toFixed(1);
  return minutes > 0 ? `${sign}${minutes}m ${seconds}s` : `${sign}${seconds}s`;
};

const source = process.env.SOURCE ?? 'unknown';
const firedAt = parse(process.env.FIRED_AT);
const createdAt = parse(process.env.CREATED_AT);
const runStartedAt = parse(process.env.RUN_STARTED_AT);

if (!createdAt) {
  console.error('CREATED_AT missing or unparseable — cannot compute drift.');
  process.exit(1);
}

const reportedSlot = parse(process.env.SCHEDULED_FOR);
const slot = reportedSlot ?? nearestHour(createdAt);
const slotIsAssumed = reportedSlot === null;

const since = (from, to) => (from && to ? to.getTime() - from.getTime() : null);

const metrics = {
  schedulerDrift: since(slot, firedAt),
  acceptLatency: since(firedAt ?? slot, createdAt),
  queueTime: since(createdAt, runStartedAt),
  totalDrift: since(slot, createdAt),
};

const outsideAssumedWindow = slotIsAssumed && Math.abs(metrics.totalDrift) > HOUR_MS / 2;

const summary = [
  `## \`${source}\``,
  '',
  `**Total drift: ${format(metrics.totalDrift)}**` +
    (slotIsAssumed ? ' _(slot inferred from `created_at`)_' : ''),
  '',
  '| Stage | Timestamp | Delta |',
  '| --- | --- | --- |',
  `| Cron slot | \`${slot.toISOString()}\` | — |`,
  `| Scheduler fired | ${firedAt ? `\`${firedAt.toISOString()}\`` : '_not reported_'} | ${format(metrics.schedulerDrift)} |`,
  `| GitHub created run | \`${createdAt.toISOString()}\` | ${format(metrics.acceptLatency)} |`,
  `| Run started | ${runStartedAt ? `\`${runStartedAt.toISOString()}\`` : '_unknown_'} | ${format(metrics.queueTime)} |`,
  '',
  outsideAssumedWindow
    ? '> [!WARNING]\n> Total drift exceeds the ±30 minute window that slot inference assumes. ' +
      'Treat this row as unreliable — the true slot may be a different hour.'
    : '',
]
  .filter(Boolean)
  .join('\n');

console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}
