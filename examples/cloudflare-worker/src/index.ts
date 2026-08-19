interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_REPOSITORY: string;
  SOURCE: string;
}

const API = 'https://api.github.com';

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
  // GitHub rejects API requests without one.
  'User-Agent': 'actions-external-cron',
});

const base64url = (input: ArrayBuffer | string) => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

// WebCrypto only accepts PKCS#8. GitHub hands you a PKCS#1 key, so this will throw
// with "invalid key" unless you converted it — see this example's README.
const importPrivateKey = (pem: string) => {
  const der = Uint8Array.from(
    atob(pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '')),
    (char) => char.charCodeAt(0),
  );
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
};

const createAppJwt = async (env: Env) => {
  const now = Math.floor(Date.now() / 1000);
  // GitHub caps app JWT lifetime at 10 minutes and rejects future `iat`, so back-date
  // slightly to absorb clock skew and stay under the cap.
  const claims = { iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID };
  const signingInput = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await importPrivateKey(env.GITHUB_APP_PRIVATE_KEY),
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64url(signature)}`;
};

const createInstallationToken = async (env: Env) => {
  const response = await fetch(
    `${API}/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
    { method: 'POST', headers: headers(await createAppJwt(env)) },
  );

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
  }

  return ((await response.json()) as { token: string }).token;
};

const dispatch = async (env: Env, scheduledFor: Date) => {
  const response = await fetch(`${API}/repos/${env.GITHUB_REPOSITORY}/dispatches`, {
    method: 'POST',
    headers: headers(await createInstallationToken(env)),
    body: JSON.stringify({
      event_type: 'scheduled-run',
      client_payload: {
        source: env.SOURCE,
        scheduled_for: scheduledFor.toISOString(),
        fired_at: new Date().toISOString(),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Dispatch failed: ${response.status} ${await response.text()}`);
  }
};

// Cron Triggers have no built-in retry — a thrown error is simply logged. If the
// dispatch matters, retry it here.
const withRetry = async (operation: () => Promise<void>, attempts = 4) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }
};

export default {
  async scheduled(event, env: Env, ctx) {
    // `scheduledTime` is the slot Cloudflare intended to fire, not the current clock.
    // That distinction is the entire measurement.
    ctx.waitUntil(withRetry(() => dispatch(env, new Date(event.scheduledTime))));
  },

  // Convenience endpoint so you can trigger a dispatch by hand while setting this up.
  async fetch(request, env: Env) {
    if (new URL(request.url).pathname !== '/dispatch') {
      return new Response('POST /dispatch to fire manually.\n', { status: 404 });
    }

    try {
      await dispatch(env, new Date());
      return new Response('Dispatched.\n');
    } catch (error) {
      return new Response(`${error}\n`, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
