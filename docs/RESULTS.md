# Results

Observation window: **2026-08-19 22:00 → 2026-10-01 06:00 UTC** (1017 hourly slots, 982 runs).

Ranked by median total drift — the gap between the cron slot and the moment GitHub
created the run. Lower is better. See [docs/PAYLOAD.md](PAYLOAD.md) for methodology.

| Scheduler | Runs | Slots hit | Median | p90 | Worst | Failed |
| --- | --- | --- | --- | --- | --- | --- |
| `github-schedule` | 982 | 95.5% | 8m 53.0s | 18m 4.0s | 29m 59.0s | 0 |

## How to read this

- **Slots hit** is the reliability number and it matters more than the latency columns.
  A scheduler that fires 4 seconds late every single hour beats one that fires instantly
  but silently skips 3% of slots.
- **Median** is the typical experience. **p90** and **Worst** are what wake you up.
- `github-schedule` is the control: GitHub's own `schedule:` trigger aiming at the same
  slot. Every other row is only interesting relative to it.

<sub>Generated 2026-10-01T06:46:32.672Z by `scripts/leaderboard.mjs`. Runs drifting more than 30 minutes are excluded — their slot cannot be inferred reliably.</sub>

