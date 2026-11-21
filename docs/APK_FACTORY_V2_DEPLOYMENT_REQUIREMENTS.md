# APK Factory V2 — Deployment Requirements

**Date**: 2026-11-17  
**Branch**: `feat/universal-build-engine-v2` @ `808f7ad`

---

## 1. Purpose

This document lists the minimum conditions that must be satisfied before APK Factory V2 can be deployed to production. It is intentionally conservative: the goal is to prevent a deployment that silently fails to build APKs.

---

## 2. Infrastructure requirements

### 2.1 Docker daemon

A Docker daemon reachable by the worker process is mandatory. The worker calls `docker run` for every build. Without it stages 4 and 5 cannot execute.

**Verification**: `docker info` must succeed from the worker process's service account.

### 2.2 Egress proxy (squid)

The build sandbox runs with `--network restricted`. All outbound traffic from the build container is routed through the squid egress proxy. The proxy must:

1. Be reachable from the build container at `BUILD_PROXY_HOST:BUILD_PROXY_PORT`.
2. Serve the allow-list at `docker/egress-proxy/allowed-domains.txt` (15 exact hostnames, no wildcards).
3. Allow HTTPS (`CONNECT`) to all 15 hosts.

**Critical domains** (new as of this audit cycle):

| Domain | Required for |
|---|---|
| `repo.reactnative.dev` | React Native AARs (react-android, hermes-android) for RN 0.80+ |
| `registry.npmjs.org` | npm / pnpm installs |
| `registry.yarnpkg.com` | yarn installs |

**Verification**: From inside a build container, `curl -x http://$BUILD_PROXY_HOST:$BUILD_PROXY_PORT https://repo.reactnative.dev/maven2/com/facebook/react/react-android/maven-metadata.xml` must return HTTP 200.

### 2.3 Docker image build

The image `docker/android-builder/Dockerfile` must be built successfully before the first build job is dispatched. The build requires:

- Internet access to `dl.google.com` (Android command-line tools, SDK packages).
- Internet access to `nodejs.org` (Node 22.23.5 tarball + SHASUMS256.txt).
- Approximately 8–12 GB of disk space for the full SDK package set (NDK alone is ~1.3 GB).
- Build time: 20–40 minutes depending on network speed.

**Verification**: `docker run --rm <image> node --version` must print `v22.23.5`. `docker run --rm <image> sdkmanager --list_installed 2>/dev/null | grep ndk` must include `27.1.12297006`.

---

## 3. Environment variables (worker)

| Variable | Required | Description |
|---|---|---|
| `DOCKER_IMAGE` | Yes | Full image tag for the Android builder (e.g. `apk-factory/android-builder:latest`) |
| `BUILD_PROXY_HOST` | Yes | Hostname/IP of the squid egress proxy |
| `BUILD_PROXY_PORT` | Yes | Port of the squid egress proxy |
| `BUILD_TIMEOUT_MS` | No | Build timeout in ms (default: 1 500 000 = 25 min) |
| `BUILD_MAX_WORKSPACE_MB` | No | Workspace disk limit in MB (default: 4096) |
| `ENABLE_RELEASE_BUILDS` | No | Defaults to on. Set `false` to allow debug APKs only. |
| `DATABASE_URL` | Yes | Prisma connection string |
| `UPLOAD_BUCKET` | Yes | Storage bucket name for APK artifacts |

---

## 4. Supported build configurations

| Framework | Build type | Status |
|---|---|---|
| Android Native | DEBUG (`assembleDebug`) | Supported |
| Android Native | RELEASE (`assembleRelease`) | Requires `ENABLE_RELEASE_BUILDS=true` and signing config |
| Android Native | AAB (`bundleRelease`) | Requires `ENABLE_RELEASE_BUILDS=true` and signing config |
| React Native CLI 0.80+ | DEBUG | Supported |
| React Native CLI 0.80+ | RELEASE | Requires `ENABLE_RELEASE_BUILDS=true` |
| Expo Managed / Bare SDK 50+ | DEBUG | Supported |
| Expo Managed / Bare SDK 50+ | RELEASE | Requires `ENABLE_RELEASE_BUILDS=true` |
| Flutter | Any | Not supported (no engine) |
| Capacitor | Any | Not supported (no engine) |

---

## 5. Supported SDK versions

| Component | Range |
|---|---|
| `compileSdkVersion` / `compileSdk` | 16–37 |
| `minSdkVersion` | 1–37 |
| `targetSdkVersion` | 1–37 |
| Android build-tools | 30.0.3, 32.0.0, 33.0.2, 34.0.0, 35.0.0, 36.0.0, 37.0.0 |
| Android platforms | 29–37 |
| NDK | 27.1.12297006 |
| CMake | 3.22.1 |
| Node.js | 22.23.5 (pinned in image) |
| JDK | 17 |
| Gradle (wrapper downloaded at build time) | Any version reachable via `services.gradle.org` |

Projects targeting `compileSdkVersion > 37` will produce a validation warning but are not rejected (the warning is advisory).

---

## 6. Security checklist

Before production deployment, verify:

- [ ] Build containers run as `builder` (uid 1000), never root.
- [ ] `--read-only` root filesystem confirmed in `sandboxArgs()` output.
- [ ] `--cap-drop ALL` confirmed in `sandboxArgs()` output.
- [ ] Workspace path is under a dedicated, isolated directory per build job (not shared between jobs).
- [ ] `BUILD_PROXY_HOST` and `BUILD_PROXY_PORT` are set; build containers cannot reach `0.0.0.0/0` directly.
- [ ] Uploaded APK artifacts are stored with owner-scoped access control (verified by `artifacts.test.cjs`).
- [ ] `ENABLE_RELEASE_BUILDS` left on (default) unless this host must refuse release APKs and AABs. Release/AAB are signed with `KEYSTORE_*` or with the worker's generated upload key.
- [ ] No secrets or API keys are present in log output (redact-diagnose layer active).
- [ ] Disk watchdog is active (`BUILD_MAX_WORKSPACE_MB` does not exceed available disk on the host).

---

## 7. Pre-deployment smoke test

Run this checklist against the target environment before enabling traffic:

```bash
# 1. Worker unit tests
cd worker && npm test
# Expected: 73/73

# 2. Docker image build
docker build -t apk-factory/android-builder:test docker/android-builder/
# Expected: exits 0

# 3. Node version in image
docker run --rm apk-factory/android-builder:test node --version
# Expected: v22.23.5

# 4. NDK installed
docker run --rm apk-factory/android-builder:test sdkmanager --list_installed 2>/dev/null | grep ndk
# Expected: contains "27.1.12297006"

# 5. Build-tools 37.0.0 installed
docker run --rm apk-factory/android-builder:test sdkmanager --list_installed 2>/dev/null | grep build-tools
# Expected: contains "37.0.0"

# 6. Egress proxy — repo.reactnative.dev reachable
docker run --rm \
  -e BUILD_PROXY_HOST=<proxy_host> \
  -e BUILD_PROXY_PORT=<proxy_port> \
  apk-factory/android-builder:test \
  sh -c 'curl -sSf -x http://$BUILD_PROXY_HOST:$BUILD_PROXY_PORT \
    https://repo.reactnative.dev/maven2/com/facebook/react/react-android/maven-metadata.xml \
    | head -3'
# Expected: HTTP 200, XML output

# 7. Android native fixture build (requires Docker daemon and egress proxy)
# Submit a minimal Android Native project (SDK 37, Kotlin DSL) via the API
# and verify an APK SHA-256 is returned.
```

---

## 8. Known blockers for production

| Blocker | Description | Resolution |
|---|---|---|
| Docker daemon not available in validation environment | Real compilation (stage 5) not exercised | Requires a host with a Docker daemon |
| `repo.reactnative.dev` live reachability not tested | Squid allow-list entry added but not verified end-to-end | Run smoke test step 6 above |
| NDK `sdkmanager` install not verified | Added to Dockerfile; requires `docker build` to verify | Run smoke test steps 2 and 4 above |
| Release signing not configured | `ENABLE_RELEASE_BUILDS=true` will fail without a keystore | Configure signing before enabling release builds |

---

## 9. Post-deployment monitoring

| Metric | Alert threshold |
|---|---|
| Build timeout rate | > 10% of jobs exceed 25 min |
| Workspace disk watchdog triggers | > 1% of jobs |
| Egress proxy `connect_rejected` | Any rejection for domains in the allow-list |
| Container OOM kills | Any |
| `REACT_NATIVE_CLI` build failure rate | > 20% (may indicate `repo.reactnative.dev` unreachable) |
