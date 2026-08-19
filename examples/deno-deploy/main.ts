import { App } from 'npm:octokit@^5.0.0';

const env = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const HOUR_MS = 3_600_000;
const nearestHour = (date: Date) => new Date(Math.round(date.getTime() / HOUR_MS) * HOUR_MS);

// Octokit accepts the PKCS#1 key GitHub gives you as-is. No openssl conversion,
// no WebCrypto import dance — compare with ../cloudflare-worker/src/index.ts.
const app = new App({
  appId: env('GITHUB_APP_ID'),
  privateKey: env('GITHUB_APP_PRIVATE_KEY'),
});

const [owner, repo] = env('GITHUB_REPOSITORY').split('/');

const dispatch = async (scheduledFor: Date) => {
  const octokit = await app.getInstallationOctokit(Number(env('GITHUB_INSTALLATION_ID')));

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
Deno.serve(async (request) => {
  if (new URL(request.url).pathname !== '/dispatch') {
    return new Response('POST /dispatch to fire manually.\n', { status: 404 });
  }

  try {
    await dispatch(nearestHour(new Date()));
    return new Response('Dispatched.\n');
  } catch (error) {
    return new Response(`${error}\n`, { status: 500 });
  }
});
