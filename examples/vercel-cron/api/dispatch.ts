export const config = { runtime: 'edge' };

const HOUR_MS = 3_600_000;
const nearestHour = (date: Date) => new Date(Math.round(date.getTime() / HOUR_MS) * HOUR_MS);

export default async function handler(request: Request): Promise<Response> {
  // Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations. Without this
  // check the route is a public "trigger my pipeline" button.
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date();

  const response = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'actions-external-cron',
      },
      body: JSON.stringify({
        event_type: 'scheduled-run',
        client_payload: {
          source: 'vercel-cron',
          scheduled_for: nearestHour(now).toISOString(),
          fired_at: now.toISOString(),
        },
      }),
    },
  );

  if (!response.ok) {
    return new Response(`Dispatch failed: ${response.status} ${await response.text()}`, {
      status: 502,
    });
  }

  return Response.json({ dispatched: true, firedAt: now.toISOString() });
}
