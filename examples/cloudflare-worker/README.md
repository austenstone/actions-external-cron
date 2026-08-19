# Cloudflare Workers Cron Triggers

**Auth:** GitHub App (no long-lived secret)
**Reports:** `scheduled_for` + `fired_at`
**Cost:** included in the Workers free plan

The reference implementation. It signs a GitHub App JWT with WebCrypto, trades it for a
1-hour installation token, and dispatches — all with zero dependencies at runtime.

## Why an App instead of a PAT

| | Fine-grained PAT | GitHub App |
| --- | --- | --- |
| Secret at rest | The token itself, long-lived | A private key that mints 1-hour tokens |
| Rate limit | 5,000 req/hr, shared across everything you own | 5,000 req/hr per installation |
| Expiry | Up to 1 year, then it silently breaks | Key does not expire; tokens rotate automatically |
| Blast radius if leaked | Everything the token can reach, until you notice | One installation, and only for an hour |

If you only ever build one of these examples, build this one.

## Setup

### 1. Create the App

[Create a GitHub App](https://github.com/settings/apps/new) with **Repository permissions →
Contents: Read and write** (that is what `POST /dispatches` requires — see
[docs/PAYLOAD.md](../../docs/PAYLOAD.md)). No webhook, no callback URL.

Install it on the target repo, then grab the installation ID from the URL of
`https://github.com/settings/installations` → **Configure**:
`.../installations/12345678` → `12345678`.

### 2. Convert the private key

**This is the step everyone gets wrong.** GitHub hands you a PKCS#1 key
(`-----BEGIN RSA PRIVATE KEY-----`). WebCrypto only imports PKCS#8. Convert it:

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in your-app.private-key.pem \
  -out private-key-pkcs8.pem
```

The result starts with `-----BEGIN PRIVATE KEY-----` (no `RSA`). If you skip this you get a
maddeningly unhelpful `DataError: invalid key` at runtime.

> The [Deno example](../deno-deploy/) uses Octokit, which handles PKCS#1 for you. That is
> the tradeoff: zero dependencies here, zero footguns there.

### 3. Deploy

```bash
npm install

npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_INSTALLATION_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < private-key-pkcs8.pem

npx wrangler deploy
```

Set `GITHUB_REPOSITORY` and `SOURCE` in [`wrangler.jsonc`](./wrangler.jsonc) — they are
config, not secrets.

### 4. Verify

```bash
# Fire the cron handler locally without waiting for the top of the hour
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"

# Or hit the deployed manual endpoint
curl -X POST https://actions-external-cron.<your-subdomain>.workers.dev/dispatch

# Watch it in production
npx wrangler tail
```

## Notes

- **`event.scheduledTime` is the slot, not the clock.** Cloudflare tells the handler which
  cron slot it is executing for, which is exactly what this repo wants to measure against.
  Most schedulers do not give you this.
- **No built-in retry.** A Cron Trigger that throws is logged and forgotten. The
  `withRetry` helper in [`src/index.ts`](./src/index.ts) exists for that reason, and it is
  wrapped in `ctx.waitUntil` so the runtime does not kill the Worker mid-backoff.
- **Cron Triggers are best-effort too.** Cloudflare makes no hard punctuality guarantee.
  That is the point of measuring rather than assuming — see the leaderboard in the
  [root README](../../README.md).
