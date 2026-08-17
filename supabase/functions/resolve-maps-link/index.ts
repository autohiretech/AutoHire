// AutoHire — resolve-maps-link Edge Function.
//
// A shortened Google Maps link (goo.gl/maps/..., maps.app.goo.gl/...) never
// carries a coordinate in the URL itself — that only exists at the far end
// of an HTTP redirect chain. A browser's own `fetch` can follow the redirect
// but can't read back the *final* URL for a cross-origin chain like this
// (Google's redirect responses don't grant that via CORS), so resolving it
// has to happen server-side, where there's no CORS to work around. This
// function does exactly that one thing: follow the redirect, hand back
// wherever it actually landed. web/src/lib/location.ts then pulls the
// coordinate out of that resolved URL the same way it would any long-form
// Maps link — this function knows nothing about coordinates itself.
//
// Deploy:  supabase functions deploy resolve-maps-link
//   (JWT verification stays ON — a host listing a car is always signed in,
//   and an anonymous open redirect-follower is exactly the kind of thing
//   that gets abused as a proxy if left unauthenticated.)

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// Only ever points this at Google's own short-link hosts — never an
// arbitrary caller-supplied host — so this can't be turned into a general
// "fetch any URL server-side" proxy.
const ALLOWED_HOSTS = ['goo.gl', 'maps.app.goo.gl'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) return json({ error: 'A url is required.' }, 400);

    let parsed: URL;
    try {
      parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      return json({ error: 'Not a valid URL.' }, 400);
    }
    if (!ALLOWED_HOSTS.includes(parsed.hostname.replace(/^www\./, ''))) {
      return json({ error: 'Only Google Maps short links can be resolved here.' }, 400);
    }

    // `redirect: 'follow'` is fetch's default, but explicit here since it's
    // the entire point of the request — Deno's fetch, unlike a browser's,
    // exposes the final URL after following it via `response.url`.
    const res = await fetch(parsed.toString(), { method: 'GET', redirect: 'follow' });
    return json({ resolvedUrl: res.url }, 200);
  } catch (err) {
    console.error('resolve-maps-link error', err);
    return json({ error: "Couldn't resolve that link." }, 500);
  }
});
