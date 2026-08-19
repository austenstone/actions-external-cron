# The payload contract

Every example in this repo sends the **same request**. That is the whole point — the
schedulers differ, the call does not.

```http
POST https://api.github.com/repos/{owner}/{repo}/dispatches
Authorization: Bearer <token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

{
  "event_type": "scheduled-run",
  "client_payload": {
    "source": "cloudflare",
    "scheduled_for": "2026-08-19T14:00:00.000Z",
    "fired_at": "2026-08-19T14:00:00.412Z"
  }
}
```

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `source` | yes | Which scheduler fired. Must be unique per example so the leaderboard can group by it. |
| `scheduled_for` | no | The cron slot the scheduler was *aiming* at. |
| `fired_at` | no | When the scheduler actually made the call. |

`scheduled_for` and `fired_at` are optional because **not every scheduler can send them.**
A plain "cron → HTTP POST" service sends a static body it cannot template. That is a real
limitation and the repo does not paper over it:

| Scheduler | Can template a timestamp into the body? | How |
| --- | --- | --- |
| Cloudflare Workers | yes | `event.scheduledTime` is handed to the handler |
| Deno Deploy | yes | computed in the handler |
| Vercel Cron | yes | computed in the route |
| AWS EventBridge Scheduler | yes | `<aws.scheduler.scheduled-time>` context attribute |
| Azure Logic Apps | yes | `@{utcNow()}` expression |
| GCP Cloud Scheduler | **no** | body is a static string |

When those fields are missing, the receiving workflow falls back to deriving the slot from
the run's `created_at`. See [Methodology](#methodology).

## `repository_dispatch` vs `workflow_dispatch`

This repo uses **`repository_dispatch`**. Both work; the tradeoffs:

| | `repository_dispatch` | `workflow_dispatch` |
| --- | --- | --- |
| Endpoint | `POST /repos/{o}/{r}/dispatches` | `POST /repos/{o}/{r}/actions/workflows/{id}/dispatches` |
| Fine-grained token permission | **Contents: write** | **Actions: write** |
| Custom data | `client_payload`, arbitrary JSON | `inputs`, must be declared in the workflow, values are strings |
| Branch | Always the default branch | Any ref, but the workflow file must exist on that ref *with the trigger declared* |
| Fan-out | One event can start many workflows | Targets exactly one workflow |

`repository_dispatch` wins here because the payload is free-form (easy to pass timestamps
through) and because one event can drive several workflows without the caller knowing
their filenames.

The catch worth knowing: `repository_dispatch` **only ever runs on the default branch.**
If you need to schedule work on a release branch, use `workflow_dispatch` with a `ref`.

## Methodology

The receiving workflow records four numbers.

```
slot ──────► fired_at ──────► created_at ──────► run_started_at
     (a)              (b)                 (c)
```

| Metric | Formula | What it tells you |
| --- | --- | --- |
| (a) scheduler drift | `fired_at - slot` | How punctual the external scheduler is |
| (b) accept latency | `created_at - fired_at` | How fast GitHub turns a dispatch into a run |
| (c) queue time | `run_started_at - created_at` | Runner availability, not scheduling |
| **total drift** | `created_at - slot` | **The headline number.** (a) + (b) |

`total drift` is the only metric available for *every* source, so it is what the
leaderboard ranks on. For GitHub's native `schedule:` control there is no `fired_at`, so
(a) and (b) cannot be separated — total drift is all you get, and it is the number people
actually complain about.

### Deriving the slot

When `scheduled_for` is absent, the slot is derived by rounding `created_at` to the
**nearest** hour (not the floor — a scheduler that fires a second *early* would otherwise
be scored as 59 minutes late).

This assumes total drift stays within ±30 minutes. Runs outside that window are recorded
but flagged as `assumed` in the results so they can be discounted. In practice GitHub's
scheduler is late, not early, and rarely by more than ~20 minutes — but "rarely" is doing
real work in that sentence, which is why this repo measures instead of guessing.
