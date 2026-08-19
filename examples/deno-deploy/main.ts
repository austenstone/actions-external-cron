import { App, Octokit } from 'npm:octokit@^5.0.0';

const env = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const HOUR_MS = 3_600_000;
const nearestHour = (date: Date) => new Date(Math.round(date.getTime() / HOUR_MS) * HOUR_MS);

const [owner, repo] = env('GITHUB_REPOSITORY').split('/');

// A PAT (Contents: write) is the fastest way to get running. The GitHub App path below
// is better hygiene — short-lived tokens — at the cost of three more variables.
//
// Octokit accepts the PKCS#1 key GitHub gives you as-is. No openssl conversion,
// no WebCrypto import dance — compare with ../cloudflare-worker/src/index.ts.
const client = (() => {
  const token = Deno.env.get('GITHUB_TOKEN');
  if (token) {
    const octokit = new Octokit({ auth: token });
    return () => Promise.resolve(octokit);
  }

  const app = new App({
    appId: env('GITHUB_APP_ID'),
    privateKey: env('GITHUB_APP_PRIVATE_KEY'),
  });

  return () => app.getInstallationOctokit(Number(env('GITHUB_INSTALLATION_ID')));
})();

const dispatch = async (scheduledFor: Date) => {
  const octokit = await client();

  await octokit.rest.repos.createDispatchEvent({
    owner,
    repo,
    event_type: 'scheduled-run',
    client_payload: {
      source: 'deno-deploy',
      scheduled_for: scheduledFor.toISOString(),
      fired_at: new Date().toISOString(),
    },
  });

  console.log(`Dispatched for slot ${scheduledFor.toISOString()}`);
};

// Unlike Cloudflare, Deno.cron does not hand the handler its scheduled time — but it does
// give you retries for free via backoffSchedule (milliseconds between attempts).
Deno.cron(
  'dispatch scheduled-run',
  '0 * * * *',
  { backoffSchedule: [1_000, 5_000, 30_000] },
  () => dispatch(nearestHour(new Date())),
);

// Deno Deploy expects a listener; this doubles as a manual trigger while setting up.
// Guarded by a shared secret, since the URL is public the moment you deploy.
Deno.serve(async (request) => {
  if (new URL(request.url).pathname !== '/dispatch') {
    return new Response('POST /dispatch to fire manually.\n', { status: 404 });
  }

  if (request.method !== 'POST') {
    return new Response('Use POST.\n', { status: 405 });
  }

  const secret = Deno.env.get('TRIGGER_SECRET');
  if (!secret) {
    return new Response('TRIGGER_SECRET is not set, so manual dispatch is disabled.\n', {
      status: 403,
    });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized.\n', { status: 401 });
  }

  try {
    await dispatch(nearestHour(new Date()));
    return new Response('Dispatched.\n');
  } catch (error) {
    return new Response(`${error}\n`, { status: 500 });
  }
});
