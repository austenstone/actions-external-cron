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

Two ways to authenticate. Pick one.

- **PAT** — one secret, 30 seconds, no key conversion. Start here.
- **GitHub App** — short-lived tokens, better hygiene, more setup. Steps 1–2 below.

### Option A: PAT (fastest)

Create a [fine-grained PAT](https://github.com/settings/personal-access-tokens/new) scoped
to the target repo with **Repository permissions → Contents: Read and write**, then:

```bash
npm install
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

That is the whole setup. Skip to [Verify](#4-verify).

> Or let CI do it: add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `DISPATCH_TOKEN`
> as repository secrets and [`deploy-cloudflare.yml`](../../.github/workflows/deploy-cloudflare.yml)
> deploys this worker on every push.

### Option B: GitHub App

#### 1. Create the App

[Create a GitHub App](https://github.com/settings/apps/new) with **Repository permissions →
Contents: Read and write** (that is what `POST /dispatches` requires — see
[docs/PAYLOAD.md](../../docs/PAYLOAD.md)). No webhook, no callback URL.

Install it on the target repo, then grab the installation ID from the URL of
`https://github.com/settings/installations` → **Configure**:
`.../installations/12345678` → `12345678`.

#### 2. Convert the private key

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

`GITHUB_TOKEN` wins if both are set, so you can migrate either direction without
redeploying.

### Optional: guard the manual endpoint

`POST /dispatch` is a convenience trigger. It stays **disabled** until you set a shared
secret, because a deployed Worker URL is public:

```bash
npx wrangler secret put TRIGGER_SECRET
```

Then call it with `Authorization: Bearer <secret>`.

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
