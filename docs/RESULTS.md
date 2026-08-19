# Results

Observation window: **2026-08-19 22:00 → 2026-08-19 22:00 UTC** (1 hourly slots, 1 runs).

Ranked by median total drift — the gap between the cron slot and the moment GitHub
created the run. Lower is better. See [docs/PAYLOAD.md](PAYLOAD.md) for methodology.

| Scheduler | Runs | Slots hit | Median | p90 | Worst | Failed |
| --- | --- | --- | --- | --- | --- | --- |
| `manual-smoke-test` † | 1 | 100.0% | -18m 8.0s | -18m 8.0s | -18m 8.0s | 0 |

## How to read this

- **Slots hit** is the reliability number and it matters more than the latency columns.
  A scheduler that fires 4 seconds late every single hour beats one that fires instantly
  but silently skips 3% of slots.
- **Median** is the typical experience. **p90** and **Worst** are what wake you up.
- `github-schedule` is the control: GitHub's own `schedule:` trigger aiming at the same
  slot. Every other row is only interesting relative to it.
- † Fewer than 12 runs. Ranked below everything else and not
  worth reading yet — one lucky dispatch is not a track record.

<sub>Generated 2026-08-19T21:44:23.824Z by `scripts/leaderboard.mjs`. Runs drifting more than 30 minutes are excluded — their slot cannot be inferred reliably.</sub>

