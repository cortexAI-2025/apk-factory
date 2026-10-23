# APK Factory

> **ZIP / GitHub / AI → APK in 1 click**

A production-ready SaaS platform that automatically builds, fixes and packages Android projects into installable APKs — no Android Studio required.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        APK Factory                          │
├──────────────┬──────────────────┬──────────────────────────┤
│   Frontend   │   Backend API    │      Build Worker         │
│  (Next.js)   │   (NestJS)       │   (BullMQ + Docker)      │
│  Port: 3000  │   Port: 4000     │   Concurrency: 2         │
├──────────────┴──────────────────┴──────────────────────────┤
│                    Infrastructure                           │
│        PostgreSQL (5432)     Redis (6379)                   │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Tech | Role |
|-----------|------|------|
| **Frontend** | Next.js 14, Tailwind, React Query | Dashboard, build viewer, upload UI |
| **Backend API** | NestJS, Prisma, JWT, WebSocket | REST API, auth, project/build management |
| **Build Worker** | BullMQ, Node.js | Async Gradle builds, AI autofix loop |
| **AI AutoFix** | Claude (Anthropic) | Error analysis + automatic patch generation |
| **Android Env** | Docker + Android SDK 34 | Isolated, sandboxed build containers |
| **Database** | PostgreSQL + Prisma | Projects, builds, logs, users |
| **Queue** | Redis + BullMQ | Async build job management |

---

## Quick Start

### Prerequisites

- Docker + Docker Compose
- Node.js 20+
- Git

### 1. Clone & setup

```bash
git clone <repo-url> apk-factory
cd apk-factory

# Install all dependencies and generate .env
bash scripts/setup.sh
```

### 2. Configure environment

```bash
# Edit .env with your values
nano .env

# Required: add your Anthropic API key for AI AutoFix
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Start infrastructure

```bash
docker-compose up -d postgres redis
```

### 4. Run migrations

```bash
bash scripts/migrate.sh
```

### 5. Start services

**Production (Docker):**
```bash
docker-compose up -d
```

**Development:**
```bash
# Terminal 1 - Backend
cd backend && npm run start:dev

# Terminal 2 - Worker
cd worker && npm run start:dev

# Terminal 3 - Frontend
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Features

### MVP (v1.0)

- **Multi-source Ingestion**
  - Upload ZIP (drag & drop, up to 500MB)
  - Import via GitHub URL (public repos)
  - GitHub OAuth (private repos)

- **Intelligent Project Analysis**
  - Auto-detect: Android Native / Flutter / React Native
  - Detect Gradle version, SDK, Kotlin version
  - Compatibility scoring (0–100%)

- **Automated Build Engine**
  - `./gradlew assembleDebug` (DEBUG)
  - `./gradlew assembleRelease` (RELEASE)
  - `./gradlew bundleRelease` (AAB)
  - Runs in isolated Docker containers with resource limits

- **AI AutoFix Loop** (powered by Claude)
  - Parse Gradle errors in real-time
  - Detect 12+ error categories (SDK mismatch, duplicate classes, unresolved deps…)
  - Generate targeted patches via LLM
  - Build → Fix → Rebuild up to 3 cycles

- **Output & Delivery**
  - APK direct download
  - Public share link (7-day expiry)
  - QR code for instant sideloading

- **Live Build Console**
  - WebSocket streaming logs
  - Progress indicators per build phase
  - AI fix timeline display

- **Auth & Plans**
  - Email/password registration
  - JWT auth
  - Free plan: 5 builds/month
  - Pro plan: unlimited builds, release signing, priority queue

---

## API Reference

Base URL: `http://localhost:4000/api/v1`  
Swagger docs: `http://localhost:4000/api/docs`

### Authentication

```http
POST /auth/register   # Create account
POST /auth/login      # Get JWT token
GET  /auth/profile    # Current user
```

### Projects

```http
GET    /projects              # List projects (paginated)
POST   /projects/upload       # Upload ZIP (multipart)
POST   /projects/import       # Import from GitHub URL
GET    /projects/:id          # Project details + builds
DELETE /projects/:id          # Delete project + files
```

### Builds

```http
POST /projects/:id/builds              # Trigger build
GET  /projects/:id/builds              # List builds
GET  /projects/:id/builds/:buildId     # Build details
GET  /projects/:id/builds/:buildId/logs # Paginated logs
POST /projects/:id/builds/:buildId/public-link # Generate share link
POST /projects/:id/builds/:buildId/cancel      # Cancel build
```

### WebSocket Events

Connect to `ws://localhost:4000/builds` with Bearer token.

```js
// Subscribe
socket.emit('subscribe:build', { buildId: '...' })

// Events received
socket.on('build:log',      ({ buildId, level, message, timestamp }) => {})
socket.on('build:status',   ({ buildId, status }) => {})
socket.on('build:complete', ({ buildId, status, apkUrl, duration }) => {})
socket.on('build:fix',      ({ buildId, attempt, description, filesModified }) => {})
```

---

## AI AutoFix - Detected Error Types

| Error Type | Description | Fix Strategy |
|------------|-------------|--------------|
| `SDK_VERSION_HIGH` | compileSdkVersion too high | Downgrade to 34 |
| `SDK_MIN_TOO_LOW` | minSdkVersion below library requirement | Raise minSdk |
| `DUPLICATE_CLASS` | Duplicate class in classpath | Add packagingOptions exclusions |
| `DEPENDENCY_UNRESOLVED` | Missing Maven dependency | Add repositories + update version |
| `PACKAGE_NOT_FOUND` | Java/Kotlin package missing | Add dependency |
| `MANIFEST_MERGE` | AndroidManifest.xml conflict | Add merge rules |
| `AAPT_ERROR` | Resource compilation failure | Fix resource files |
| `DEPRECATED_API` | Old Gradle DSL used | Update to current API |
| `PLUGIN_NOT_FOUND` | Gradle plugin not found | Add plugin repository |
| `BUILD_TOOLS_TOO_LOW` | Build tools version outdated | Update to 34.0.0 |
| `KOTLIN_ERROR` | Kotlin compilation error | AI-generated patch |
| `OOM` | Out of memory | Increase JVM heap |

---

## Project Structure

```
apk-factory/
├── backend/                    # NestJS REST API
│   ├── src/
│   │   ├── auth/              # JWT auth + registration
│   │   ├── projects/          # Project CRUD + analysis
│   │   ├── builds/            # Build orchestration
│   │   ├── queue/             # BullMQ service
│   │   ├── storage/           # File management
│   │   ├── ai/                # Error parser + AI fixer
│   │   └── gateway/           # WebSocket (live logs)
│   └── prisma/schema.prisma   # Database schema
├── worker/                     # Standalone build worker
│   └── src/
│       ├── index.ts           # Worker entry + BullMQ consumer
│       ├── build-executor.ts  # Gradle runner + orchestration
│       ├── log-parser.ts      # Error detection from logs
│       └── ai-fixer.ts        # LLM + rule-based patches
├── frontend/                   # Next.js 14 App Router
│   └── src/
│       ├── app/               # Pages (dashboard, projects, builds)
│       ├── components/        # Reusable UI components
│       └── lib/               # API client, hooks, types
├── docker/
│   ├── android-builder/       # Android SDK build image
│   ├── backend/               # Backend Dockerfile
│   ├── worker/                # Worker Dockerfile
│   └── frontend/              # Frontend Dockerfile
├── scripts/
│   ├── setup.sh               # Initial setup
│   └── migrate.sh             # DB migrations
├── docker-compose.yml
└── .env.example
```

---

## Security

- Each build runs in an isolated Docker container
- CPU and RAM limits enforced per container (4 CPU / 6GB)
- 25-minute build timeout
- Worker authentication via shared secret
- JWT tokens with 7-day expiry
- File uploads validated and size-limited

---

## Roadmap (V2)

- [ ] Flutter & React Native support
- [ ] Build via AI prompt (generate app + build)
- [ ] Release signing with custom keystore
- [ ] APK version management
- [ ] GitHub Actions integration
- [ ] Public API (Build-as-a-Service)
- [ ] White-label support
- [ ] S3 storage backend
- [ ] Stripe billing integration

---

## License

MIT

## Worker regression checks

```bash
cd worker
npm ci --ignore-scripts
npm test
```

These checks compile the worker and test artifact delivery without Docker, an
Android SDK, a database, or an AI key. The output stage selects only Gradle
outputs for the requested build type: debug APK, release APK, or release AAB.
It fails if the requested output is missing or multiple matching outputs exist,
rather than delivering a different variant, module, or split. Projects producing
multiple outputs need an explicit artifact-selection feature before delivery.
These checks do not replace an end-to-end Android build on a configured worker.


## Isolated build workspaces

ZIP uploads and GitHub imports are copied from their stored source directory to
an independent directory under `WORKSPACE_DIR` for each build. In Compose, this
path must be bind-mounted at the **same absolute path on the host and worker**,
as in the supplied `/tmp/apk-factory/workspaces` mount. The Docker daemon cannot
resolve the worker's `/app/uploads/...` named-volume path as a host source.

AI fixes and Gradle output affect only the build copy. Previous `build/` outputs,
`.gradle`, `.git`, and `node_modules` directories are omitted. Symbolic links are
rejected explicitly. Concurrent builds and retries receive distinct directories.
The workspace is removed after artifact upload or a pipeline failure; original
sources remain available until the configured retention policy deletes them.

## Android end-to-end smoke check

Run against a **disposable test stack**, with PostgreSQL migrations applied,
Redis, backend, worker, and the `apk-factory/android-builder:latest` image ready.
Build the sandbox image first if needed:

```bash
docker compose --profile init build android-builder-init
```

Provide a ZIP of a small, known-buildable native Android application containing
its Gradle wrapper. Use SDK/Gradle versions available in the builder image and
allow dependency resolution, or supply a complete offline Maven cache. Node 20+
and `unzip` must be installed on the machine running this check.

```bash
SMOKE_API_URL=http://localhost:4000 \
  node scripts/smoke-build.mjs /absolute/path/native-android.zip
```

The script registers a temporary Free account (three builds), uploads the ZIP,
and sequentially requests DEBUG, RELEASE, and AAB with AI AutoFix disabled. It
waits for each terminal status, downloads the expected artifact, checks size and
ZIP integrity plus the Android manifest, and compares the share-link download
by SHA-256. `SMOKE_API_URL` must match the backend's public `API_BASE_URL` origin.

Artifacts and `report.json` are written to a unique `/tmp/apk-factory-smoke-*`
directory, overridable with `SMOKE_OUTPUT_DIR`. Each build has a 30-minute wait
limit, configurable with `SMOKE_TIMEOUT_MS`. A failure returns a nonzero exit
code and saves available build logs. Test data is retained on failure for
investigation; on success only the newly created account and projects are
deleted. Downloaded files remain available in the output directory.

This check uses the actual API, queue, sandbox and storage: it cannot run without
a configured stack. It does not verify release signing, APK installation,
device behaviour, frontend interactions, or GitHub import. Release outputs can
be unsigned until custom keystore support is implemented.
