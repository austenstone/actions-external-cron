# Vercel Cron Jobs

**Auth:** fine-grained PAT in an environment variable
**Reports:** `scheduled_for` (inferred) + `fired_at`
**Cost:** free on Hobby, included on Pro

Two files: a `vercel.json` entry and an API route. If you already deploy to Vercel this
costs you about ninety seconds.

**Read the caveats before choosing this one.** It is the weakest option here for the
specific problem this repo is about.

## Setup

### 1. Create the token

A [fine-grained PAT](https://github.com/settings/personal-access-tokens/new) scoped to the
target repository with **Contents: Read and write**.

### 2. Configure and deploy

```bash
npm install

npx vercel env add GITHUB_TOKEN production
npx vercel env add GITHUB_REPOSITORY production
npx vercel env add CRON_SECRET production   # any long random string

npx vercel deploy --prod
```

Generate a `CRON_SECRET` with `openssl rand -hex 32`. Vercel automatically sends it as a
bearer token on cron invocations, and [`api/dispatch.ts`](./api/dispatch.ts) rejects
anything else.

### 3. Verify

```bash
curl -X POST https://<your-deployment>.vercel.app/api/dispatch \
  -H "Authorization: Bearer $CRON_SECRET"
```

Cron executions show up under **Project → Observability → Crons**.

## Caveats

These matter enough to list before the notes.

- **Hobby is once per day, maximum two crons.** `0 * * * *` will be rejected. Hourly
  scheduling requires a Pro plan.
- **Vercel crons are explicitly best-effort.** The docs say invocations may be delayed
  under load — the exact property this repo exists to work around. Including Vercel is
  useful precisely because the leaderboard will show whether "best-effort" here is
  meaningfully better than "best-effort" on GitHub's side. It may not be.
- **No built-in retry.** A failed cron invocation is not retried. You would need to
  implement retries inside the handler, or accept the miss.

## Notes

- **Always check `CRON_SECRET`.** An unauthenticated dispatch route is a public trigger
  for whatever your workflow does. This is the single most commonly skipped step.
- **Edge runtime keeps it fast** — no cold start worth worrying about for a single
  outbound fetch. Drop `export const config` to run it on Node instead.
- **Static schedules only.** `vercel.json` is committed, so changing the cadence means a
  redeploy. Fine for a fixed schedule, awkward if you want it dynamic.
