# APK Factory HTTP API contract

Autonomous client contract for the API already implemented in this repository.
Prefix: `/api/v1`. This document does not add endpoints and does not couple
APK Factory to any other product. Interactive schema (non-production only):
`/api/docs`.

Framework selection is not a request field. The worker detects the project
(Android native, Flutter, React Native, Expo managed, Expo bare, Capacitor,
Cordova) during the build. The client chooses only the artifact kind.

## Authentication

`POST /api/v1/auth/login` with `{ "email", "password" }` returns
`{ "user", "token" }`. Send `Authorization: Bearer <token>` on every route
below except login, register, health, and the public download.

`POST /api/v1/auth/register` (`email`, `name`, `password` of 8–72 chars)
exists only when public registration is enabled. Otherwise it responds 403.

`GET /api/v1/auth/profile` returns the caller.

`POST /api/v1/auth/api-keys` with `{ "name" }` stores a key and returns the
raw `apk_…` value once. That value is **not** accepted as a credential by
any route today. Clients must use the JWT.

Missing or invalid JWT: 401. A resource owned by another user: 403.
Unknown JSON fields: 400 (`forbidNonWhitelisted`).

## Submit a project

`POST /api/v1/projects/upload`  
`multipart/form-data`: `file` (one `.zip`, default max 200 MB), optional
`name`, optional `description`.

`POST /api/v1/projects/import`  
`{ "sourceUrl", "name?", "description?", "sourceType?" }`.  
`sourceUrl` is a GitHub repository, a `/tree/<branch>/<folder>` URL, or a
GitHub ZIP URL. `sourceType` is `GITHUB_URL` or `GITHUB_OAUTH`.

`GET /api/v1/projects?page=1&limit=20` lists the caller's projects.  
`GET /api/v1/projects/:projectId` returns one.  
`DELETE /api/v1/projects/:projectId` deletes one.

The response includes the project id used to request builds. The server does
not trust a client-supplied framework.

## Request a build

`POST /api/v1/projects/:projectId/builds`

```json
{ "buildType": "DEBUG", "autoFix": true }
```

`buildType` is `DEBUG` (debug APK), `RELEASE` (release APK), or `AAB`
(release Android App Bundle). `autoFix` defaults to true.

Release APK and AAB are accepted unless `ENABLE_RELEASE_BUILDS` is `false`
or `0`. When disabled, those two values respond 400 with
`Only debug APK builds are supported in this version.`

Other 400 cases: build quota exceeded on the Free plan; project files already
deleted by retention. 404 if the project does not exist.

The build is persisted, then queued. The response status is `QUEUED` and
includes `id` and `queueJobId`.

## Follow a job

`GET /api/v1/projects/:projectId/builds`  
`GET /api/v1/projects/:projectId/builds/:buildId`  
`GET /api/v1/projects/:projectId/builds/:buildId/logs?offset=0&limit=500`

`buildId` in the detail, log, download, and cancel routes is the build id.
Statuses: `PENDING`, `QUEUED`, `BUILDING`, `FIXING`, `SUCCESS`, `FAILED`,
`CANCELLED`, `TIMEOUT`.

On `SUCCESS`, the build object includes `artifacts[]` with `id`, `fileName`,
`variant`, `abi`, `module`, `sizeBytes`, `sha256`, `recommended`.
On `FAILED` or `TIMEOUT`, `errorMessage` is set. Logs are the compilation
trace. They must not contain keystore passwords or key paths.

`POST /api/v1/projects/:projectId/builds/:buildId/cancel` requests cancellation.

Socket.IO namespace `/builds`. Pass the JWT as `auth.token` or
`Authorization: Bearer`. Then emit `subscribe:build` with `{ "buildId" }`.
Server events on room `build:<buildId>`:

- `build:log` — `{ buildId, level, message, timestamp }`
- `build:status` — `{ buildId, status, ...metadata }`
- `build:complete` — `{ buildId, status, apkUrl?, qrCodeUrl?, duration?, errorMessage? }`
- `build:fix` — `{ buildId, attempt, description, filesModified }`

REST polling remains sufficient. The socket is optional.

## Download and integrity

Owner download (JWT, project owner only):

`GET /api/v1/projects/:projectId/builds/:buildId/artifacts/:artifactId/download`

Both ids are UUIDs. The body is the APK or AAB. Response headers:

- `X-Artifact-SHA256`: hex SHA-256 of the stored bytes
- `Cache-Control: private, no-store`
- `X-Content-Type-Options: nosniff`

The client recomputes SHA-256 on the downloaded bytes and compares it to
`X-Artifact-SHA256` and to `artifacts[].sha256`.

`POST /api/v1/projects/:projectId/builds/:buildId/public-link` (owner) returns
a time-limited URL and a QR code. Anyone holding the token can then call
`GET /api/v1/download/:token` with no JWT, until expiry. That public response
does not send `X-Artifact-SHA256`; hash the body and compare it to the
checksum previously read from the owner build payload. Expired or unknown
tokens respond 404.

Artifacts are not served as static files.

## What this contract does not include

Worker callbacks under `/api/v1/internal/builds` require `WORKER_SECRET`.
They are not a client API.

PostgreSQL stores projects, builds, logs, and artifact rows. Redis/BullMQ
carries the job queue. Neither is reachable by substituting a local file
copy for these routes.
