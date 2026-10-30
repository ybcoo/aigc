# Video Editor

Requires `ffmpeg` and `ffprobe` in PATH. The FFmpeg build needs libx264, AAC,
libmp3lame, xfade, libass/subtitles and drawtext for all export options.

Apply database changes with `npx prisma migrate deploy` and regenerate the
client with `npx prisma generate` before starting the backend.

Editor routes are scoped to `/api/projects/:projectId/episodes/:episode/editor`:

- GET loads the draft, media library and current canvas video/audio candidates.
- PUT saves `{ timeline, revision }` using optimistic revision checks.
- POST `import` imports an owned video/audio node and probes its real duration.
- POST `media/video` or `media/audio` accepts a multipart `file` up to 100 MB.
- POST `exports` creates a cancellable background FFmpeg task from a snapshot.
- POST `exports/:jobId/cancel` interrupts its FFmpeg processes.

The existing project jobs API also lists and cancels export tasks. Export does
not call AI providers. Imported media is pinned independently of canvas history.
Drafts and libraries are separate for each episode; timeline values use 30 fps.

Run `npm run build` then `npm run test:editor` for isolated database tests and
real local FFmpeg export verification. Tests remove their projects and files.
