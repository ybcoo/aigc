# Media Storage

Set `STORAGE_DRIVER=local` or `STORAGE_DRIVER=oss` in the backend `.env`.
The default when omitted is `local`. Restart the backend after changing `.env`;
source-file hot reload does not reliably reload process environment variables.

- `local` keeps `/uploads/aigc/...` URLs and files on this server.
- `oss` uploads to Cloudflare R2 and stores URLs under `R2_PUBLIC_BASE_URL`.
- Switching does not migrate or delete existing files. Old local URLs still work.
- Missing/invalid R2 settings or upload failures are errors, never silent local fallback.

OSS uses the existing `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_REGION` (default `auto`),
`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_PUBLIC_BASE_URL`.
`R2_ENDPOINT` can be inferred from `R2_ACCOUNT_ID`; `R2_PUBLIC_BASE_URL` must be
a publicly readable bucket custom domain, not the authenticated S3 endpoint.
Credentials remain server-side and are never returned to the frontend.

Uploads, reference images/videos/audio, generated images/videos, imported editing
media and MP4/MP3 exports share this backend. FFmpeg still uses temporary local
working files; OSS imports/exports are cleaned from the local working directory.
Existing local video/audio references can be published to R2 when OSS mode is
enabled. Local mode still needs `PUBLIC_ASSET_BASE_URL` for video/audio references.

Configure R2 CORS for the origins listed in `FRONTEND_ORIGIN`, allowing `GET` and
`HEAD` and exposing `Content-Range`, `Content-Length`, `Accept-Ranges`, and `ETag`.
`npm run storage:configure-cors` preserves existing bucket rules and adds/updates
only the `aigc-frontend-read` rule. It requires bucket-settings permissions; if
the object credentials lack those permissions, configure CORS in the dashboard.
An example matching the current local frontend origins is in `r2-cors.json`.
Re-run it after changing frontend domains. Existing cached objects may require
cache purging to receive updated headers.

After building:

```sh
npm run build
npm run test:storage
STORAGE_DRIVER=oss npm run storage:check
```

The last command uploads one temporary 1-pixel PNG, verifies S3/public reads,
Range and browser CORS, and deletes the temporary object. It never calls an AI
model. Unit/integration tests use fake S3 responses or explicitly force local
storage; they do not upload project assets to your R2 bucket.

References: [R2 JavaScript SDK](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/),
[public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/),
[CORS](https://developers.cloudflare.com/r2/buckets/cors/).
