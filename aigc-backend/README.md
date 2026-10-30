# AIGC Backend

NestJS API for AIGC Studio scripts, canvas nodes, AI configuration, background
generation jobs, media history and FFmpeg editing/export. Each service keeps its
controller/module/service files together under `src/<service>/`.

## Development

Requirements: Node.js 24, PostgreSQL 16, FFmpeg and ffprobe. FFmpeg needs libx264,
AAC, libmp3lame, libass/subtitles, drawtext and xfade; Chinese text needs CJK fonts.

On first setup:

```bash
cp .env.example .env
npm ci
```

Create the database and edit `DATABASE_URL` in `.env`. Prisma does not consume
separate `DB_HOST` / `DB_USER` variables. URL-encode special characters in database
credentials. Do not overwrite an existing `.env` during upgrades.

```bash
npm run prisma:generate
npm run db:migrate
npm run start:dev
```

The API defaults to <http://localhost:3001/api>. Source changes trigger hot reload;
restart after changing environment variables. Outside Compose, startup does not
apply migrations automatically.

## Production

```bash
npm ci
npm run prisma:generate
npm run build
npm run db:migrate
npm run start:prod
```

The compiled entry point is `dist/src/main.js`. Supply environment variables through
the process/container or a private `.env`. Shutdown hooks stop in-process workers
on termination signals. Use only one backend replica: task controllers are local
to the process, and startup marks interrupted jobs as failed.

For Docker, follow [the root instructions](../README.md). The image includes Prisma
migrations, FFmpeg and CJK fonts, runs as `node`, and uses `/app/uploads` for media.
Its default command does not migrate the database: Compose's `migrate` service runs
first. The HTTP health probe requests `/api`.

## Environment

See [.env.example](.env.example) for sanitized settings:

- `DATABASE_URL`: PostgreSQL connection string, including `?schema=public`.
- `PORT`: API port, default 3001.
- `FRONTEND_ORIGIN`: comma-separated allowed frontend origins.
- `STORAGE_DRIVER`: `local` (default) or `oss` (Cloudflare R2).
- `PUBLIC_ASSET_BASE_URL`: public backend origin for local provider references;
  remote models cannot fetch `localhost`.
- `R2_*`: bucket, credentials, endpoint/account ID and public asset domain.

Configure provider models/keys in the app; they are stored in PostgreSQL, not in
frontend variables. The API currently has no user authentication. Protect API and
media routes before exposing them outside a trusted environment.

Details: [storage](src/storage/README.md), [editor](src/editor/README.md).

## Verification

Tests consume compiled output, so build first:

```bash
npm run build
npm run test:image-provider
npm run test:video-provider
npm run test:script-provider
npm run test:script-import
```

Integration tests require a migrated, disposable test database in `DATABASE_URL`:

```bash
npm run test:script
npm run test:canvas-generation
npm run test:media-history
npm run test:editor
npm run test:storage
```

They remove their temporary records and use fake AI providers. Editor tests invoke
real local FFmpeg. Never run integration tests against production.
