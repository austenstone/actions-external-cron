# Deno Deploy — `Deno.cron()`

**Auth:** GitHub App (via Octokit)
**Reports:** `scheduled_for` (inferred) + `fired_at`
**Cost:** included in the Deno Deploy free tier

The shortest path to correct auth. `Deno.cron()` is part of the runtime — no config file,
no YAML, no dashboard. Declare the schedule in the same file that does the work.

## Setup

### 1. Create the App

Same as the [Cloudflare example](../cloudflare-worker/README.md#1-create-the-app):
**Contents: Read and write**, installed on the target repo.

**No key conversion needed.** Octokit accepts GitHub's PKCS#1 key directly. Paste it
exactly as downloaded.

### 2. Deploy

```bash
deno install
deno task check

deployctl deploy --project=actions-external-cron --prod main.ts
```

Set these in the Deno Deploy dashboard under **Settings → Environment Variables**:

| Variable | Value |
| --- | --- |
| `GITHUB_APP_ID` | e.g. `1234567` |
| `GITHUB_INSTALLATION_ID` | e.g. `12345678` |
| `GITHUB_APP_PRIVATE_KEY` | the full PEM, newlines and all |
| `GITHUB_REPOSITORY` | `owner/repo` |

> Paste the private key through the dashboard, not the CLI. Multi-line secrets get
> mangled by shell quoting in ways that are tedious to debug.

### 3. Verify

```bash
# Local: --unstable-cron is required outside Deno Deploy
deno task dev
curl -X POST http://localhost:8000/dispatch
```

Deployed crons appear under the project's **Cron** tab with their execution history.

## Notes

- **Built-in retries.** `backoffSchedule: [1000, 5000, 30000]` retries a throwing handler
  three times with those delays. Cloudflare makes you write that loop yourself.
- **No scheduled-time parameter.** `Deno.cron` does not tell the handler which slot it is
  running for, so `main.ts` rounds the current time to the nearest hour. Accurate unless
  the runtime is more than 30 minutes late, in which case you have bigger problems.
- **`Deno.cron` must be top-level.** Calling it inside a request handler or conditionally
  will not register the schedule.
- **One invocation at a time.** Deno will not start a second run of the same cron while
  the previous one is still going, which is a nice guardrail a raw HTTP scheduler lacks.
