# Deck locker

The Cloudflare Worker behind "Send a link". It stores **sealed** decks: the
browser encrypts each deck with a fresh key before uploading, and that key
exists only in the link's `#fragment`, which never reaches this Worker. See
`src/index.ts` for the whole thing (~100 lines) and `../src/deck/cloud.ts` for
the browser side.

Until this is deployed and the site is told where it is, the app simply hides
"Send a link" and offers "Send the file" only.

## Deploy (once)

```sh
cd worker
npm install
npx wrangler login
npx wrangler r2 bucket create four-quarters-decks
# Delete decks after 30 days (the Worker also refuses to serve older ones).
npx wrangler r2 bucket lifecycle add four-quarters-decks expire-30d --expire-days 30 -y
npx wrangler deploy
```

`deploy` prints the Worker's address, e.g.
`https://four-quarters-decks.<your-subdomain>.workers.dev`.

Then point the site at it: on GitHub, **Settings → Secrets and variables →
Actions → Variables → New repository variable**, name `QUARTERS_CLOUD_URL`,
value that address. Re-run the "Deploy to Pages" workflow (or push to `main`).

If the site moves (a custom domain via `public/CNAME`), add the new origin to
`ALLOWED_ORIGINS` in `wrangler.toml` and `npx wrangler deploy` again —
uploads from any other origin are refused.

## Limits

- 2 MB per deck (a full 24-card deck is well under 1 MB).
- 10 uploads per minute per IP (`[[ratelimits]]` in `wrangler.toml`).
- Free tier covers this comfortably: R2 gives 10 GB of storage, Workers 100k
  requests a day.

## Local development

```sh
cd worker && npm run dev          # http://localhost:8787, simulated R2 on disk
# in the repo root:
VITE_QUARTERS_CLOUD=http://localhost:8787 npm run build
npm run preview -- --port 4178
npm run check:flow                # also covers the link path when the build has one
```
