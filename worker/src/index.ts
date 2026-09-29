/**
 * The one piece of Four Quarters that runs anywhere but the viewer's browser: a
 * dumb locker for sealed decks, so a deck can travel as a link instead of a file.
 *
 * It never sees a picture. The browser encrypts the deck with a fresh AES-GCM
 * key before uploading, and that key lives only in the link's #fragment, which
 * browsers do not send to any server — this one included. What arrives here is
 * indistinguishable from random bytes, so the worst this Worker can leak is how
 * many decks exist and how big they are. (Same design as Excalidraw's share
 * links: https://plus.excalidraw.com/blog/end-to-end-encryption)
 *
 * Deliberately small:
 *   POST /d      body = sealed bytes  ->  201 {"id": "..."}
 *   GET  /d/:id                      ->  200 sealed bytes, or 404
 *
 * No listing, no overwrite, no delete, no accounts. Ids are random and chosen
 * here, so a caller cannot pick one to squat on or guess its way to others.
 * Decks expire after MAX_AGE_DAYS; that is enforced on read as well, so expiry
 * holds even if the bucket's lifecycle rule was never set up.
 */

type R2Object = { uploaded: Date; body: ReadableStream; size: number };
type Bucket = {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: ArrayBuffer, options?: object): Promise<unknown>;
};
type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

type Env = {
  DECKS: Bucket;
  /** Comma-separated origins allowed to call this (the site, plus a dev server). */
  ALLOWED_ORIGINS: string;
  /** Optional: Workers rate limiting binding for uploads, keyed by client IP. */
  UPLOADS?: RateLimiter;
};

/** A six-card deck is ~100 KB; a full 24-card one well under 1 MB. */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_AGE_DAYS = 30;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function newId(): string {
  // 16 random bytes, base64url: 128 bits, unguessable, 22 characters.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((entry) => entry.trim());
  return allowed.includes(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

function reply(status: number, body: BodyInit | null, headers: Record<string, string>) {
  return new Response(body, { status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = cors(request, env);

    if (request.method === 'OPTIONS') return reply(204, null, headers);

    if (request.method === 'POST' && url.pathname === '/d') {
      // Only the site may upload. A browser always sends Origin on a cross-site
      // POST, so a missing or foreign one is a script, not the app.
      if (!headers['Access-Control-Allow-Origin']) return reply(403, 'Forbidden', headers);

      if (env.UPLOADS) {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        if (!(await env.UPLOADS.limit({ key: ip })).success) {
          return reply(429, 'Too many uploads, try again in a minute.', headers);
        }
      }

      const declared = Number(request.headers.get('Content-Length') ?? '0');
      if (declared > MAX_BYTES) return reply(413, 'Too large', headers);
      const body = await request.arrayBuffer();
      if (body.byteLength === 0) return reply(400, 'Empty', headers);
      if (body.byteLength > MAX_BYTES) return reply(413, 'Too large', headers);

      const id = newId();
      await env.DECKS.put(id, body, {
        httpMetadata: { contentType: 'application/octet-stream' },
      });
      return reply(201, JSON.stringify({ id }), {
        ...headers,
        'Content-Type': 'application/json',
      });
    }

    const match = url.pathname.match(/^\/d\/([^/]+)$/);
    if (request.method === 'GET' && match) {
      const id = match[1];
      if (!ID_PATTERN.test(id)) return reply(404, 'Not found', headers);
      const object = await env.DECKS.get(id);
      const age = object ? Date.now() - object.uploaded.getTime() : Infinity;
      if (!object || age > MAX_AGE_DAYS * 86_400_000) return reply(404, 'Not found', headers);
      return reply(200, object.body, {
        ...headers,
        'Content-Type': 'application/octet-stream',
        // Immutable once written; a browser may keep it for the deck's lifetime.
        'Cache-Control': 'private, max-age=86400, immutable',
      });
    }

    return reply(404, 'Not found', headers);
  },
};
