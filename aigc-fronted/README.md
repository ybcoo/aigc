# AIGC Frontend

Nuxt 4 / Vue 3 application with a Vue Flow infinite canvas and video editor. Create
projects from scripts or TXT chapters, connect references between nodes, inspect
media history, and run/cancel generation tasks independently.

The directory name `aigc-fronted` is retained for compatibility.

## Development

Requires Node.js 24 and a running AIGC backend. On first setup:

```bash
cp .env.example .env
npm ci
npm run dev
```

The frontend defaults to <http://localhost:3000>. The example points to
`http://localhost:3001/api`. When ports change, update the API URL and the backend's
`FRONTEND_ORIGIN` together. Do not overwrite an existing `.env` during upgrades.

## Production

```bash
npm ci
npm run build
HOST=0.0.0.0 PORT=3000 NUXT_PUBLIC_API_BASE=https://api.example.com/api node .output/server/index.mjs
```

`NUXT_PUBLIC_API_BASE` is public runtime configuration: use an absolute URL ending
in `/api` that the user's browser can reach, not the Docker hostname `backend`.
Never place credentials in `NUXT_PUBLIC_*` variables. The production Node server
does not automatically read `.env`; inject variables through the deployment
environment. Docker Compose does this for you.

See [root deployment instructions](../README.md) for Docker, database and storage
configuration. The frontend image contains only Nuxt's standalone `.output`, runs
as a non-root user, and listens on port 3000.

## Verification

```bash
npm run test:home
npm run test:canvas
npm run test:editor
npm run build
```

UI tests use DOM fixtures/fake APIs and do not invoke paid models. Retain the
[featured media attribution](public/featured/README.md) when publishing.
