# APK Factory V2 — Audit Report

**Date**: 2026-11-17  
**Branch**: `feat/universal-build-engine-v2`  
**Head commit at audit start**: `318ffea`  
**Head commit at audit end**: `808f7ad`  
**Test suite**: 73/73 ✓

---

## 1. Scope

This audit covers:

| Area | Verdict |
|---|---|
| Framework detection | ✓ Correct |
| Project validation (stages 1–3) | ✓ Correct after fixes |
| Docker isolation & sandbox constraints | ✓ Correct |
| Volume / path security | ✓ Correct |
| Resource management (RAM/CPU/disk/timeout) | ✓ Correct |
| Log handling & secret redaction | ✓ Correct |
| Temp file cleanup | ✓ Correct |
| APK preservation | ✓ Correct |
| Egress allow-list (squid proxy) | ✓ Fixed |
| Dockerfile (Node, JDK, SDK, NDK) | ✓ Fixed |

---

## 2. Framework Detector (`worker/src/detection/framework-detector.ts`)

The detector is a pure, side-effect-free async function. It reads only the filesystem of the submitted project root.

**Scoring**: 9 frameworks scored from filesystem signals. Confidence = winner score / total score. If the runner-up is within 70 % (`AMBIGUITY_RATIO = 0.7`) the detection is flagged ambiguous.

**Supported frameworks with an implemented engine**:

| Framework | Engine | Shell mode |
|---|---|---|
| `ANDROID_NATIVE` | `android-native.engine.ts` | false |
| `REACT_NATIVE_CLI` | `react-native-cli.engine.ts` | true |
| `EXPO_MANAGED` | `expo.engine.ts` | true |
| `EXPO_BARE` | `expo.engine.ts` | true |

Unsupported frameworks (CAPACITOR, FLUTTER, VITE_WEB, NEXTJS_WEB) are detected correctly and rejected with an explicit, distinct error — they are never silently attempted.

**Verdict**: No defects. `mapFrameworkToProjectType()` bridges to the Prisma enum correctly.

---

## 3. Project Validation (`worker/src/pipeline/stages/03-validate.ts`)

### Finding AUD-01 — `MAX_SUPPORTED_SDK` stale (FIXED, commit `808f7ad`)

| | |
|---|---|
| **Severity** | Medium |
| **Status** | Fixed |
| **File** | `worker/src/pipeline/stages/03-validate.ts:14` |

**Problem**: `MAX_SUPPORTED_SDK` was set to `35`. After the Dockerfile was updated in commit `318ffea` to install `platforms;android-37.0` and `build-tools;37.0.0`, any project with `compileSdkVersion 37` would generate a spurious warning "may require a newer Android SDK than available (max: 35)".

**Fix**: Changed `MAX_SUPPORTED_SDK = 35` → `MAX_SUPPORTED_SDK = 37`.

**Regression guard**: Phase 4 fixture 1 and the regression test both confirm SDK 37 no longer triggers the warning.

---

## 4. Docker Sandbox

### 4.1 Isolation architecture

- Container runs as non-root `builder` (uid 1000, gid 1000).
- Root filesystem is `--read-only`; writable paths are tmpfs only: `/tmp` (2 GB) and `/tmp/gradle`, `/tmp/npm`, `/tmp/cache`.
- All Linux capabilities dropped (`--cap-drop ALL`).
- PID limit 512 (`--pids-limit 512`).
- RAM 4 GB (`--memory 4g`), CPU 2 (`--cpus 2`).
- Network mode `restricted` via egress proxy; build containers cannot reach the open internet directly.

### 4.2 Egress proxy (squid allow-list)

**Finding AUD-02 — `repo.reactnative.dev` absent from allow-list (FIXED, commit `808f7ad`)**

| | |
|---|---|
| **Severity** | Critical |
| **Status** | Fixed |
| **File** | `docker/egress-proxy/allowed-domains.txt` |

**Problem**: React Native 0.80+ uses `repo.reactnative.dev/maven2` as the **exclusive** Maven host for `com.facebook.react:react-android` and `com.facebook.hermes:hermes-android` AARs. Maven Central 301-redirects `com.facebook.react:*` to this mirror. Without the domain in the allow-list every RN CLI and Expo build fails at Gradle dependency resolution with HTTP 403 or `connect_rejected`.

**Fix**: Added `repo.reactnative.dev` to `allowed-domains.txt`. Comment rewritten to avoid the `*` character, which would have broken the squid wildcard-rejection test (test 57 of 73).

**Current allow-list domains** (all exact hostnames, no wildcards):

```
dl.google.com
maven.google.com
repo.maven.apache.org
repo1.maven.org
plugins.gradle.org
plugins-artifacts.gradle.org
services.gradle.org
downloads.gradle.org
jitpack.io
github.com
objects.githubusercontent.com
release-assets.githubusercontent.com
registry.npmjs.org
registry.yarnpkg.com
repo.reactnative.dev
```

---

## 5. Dockerfile (`docker/android-builder/Dockerfile`)

### 5.1 Node version

Node 22.23.5 (LTS "Jod") — fixed in commit `318ffea`. React Native 0.80+ requires `engines: { node: ">= 22.11.0" }`.

Checksum verified at image-build time against Node's published `SHASUMS256.txt`. Not downloaded during builds.

### 5.2 JDK

OpenJDK 17 (`openjdk-17-jdk-headless`). Compatible with Gradle ≥ 8.0 and Gradle 9.4.1.

### 5.3 Android SDK

Platforms installed: `android-37.0` through `android-29` (9 versions). Build-tools: `37.0.0` through `30.0.3` (7 versions). `PATH` updated to include `build-tools/37.0.0`.

### 5.4 NDK & CMake

**Finding AUD-03 — NDK 27 absent from Dockerfile (FIXED, commit `808f7ad`)**

| | |
|---|---|
| **Severity** | High |
| **Status** | Fixed |
| **File** | `docker/android-builder/Dockerfile:66-67` |

**Problem**: React Native 0.88.1 declares `ndkVersion = "27.1.12297006"` in `android/build.gradle`. Without NDK 27 installed in the image, the C++ compilation step (Hermes JSI, Yoga, Folly) would fail with "NDK not configured".

**Fix**: Added `"ndk;27.1.12297006"` and `"cmake;3.22.1"` to the `sdkmanager` install list.

### 5.5 Corepack / package managers

Corepack enabled; pinned versions: `pnpm@9.12.3`, `yarn@1.22.22`. Projects can override via `packageManager` field in `package.json`. `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` prevents interactive prompts inside the container.

### 5.6 Certificate configuration

The image installs `ca-certificates`. The build proxy CA bundle is injected at runtime via `BUILD_PROXY_HOST` / `BUILD_PROXY_PORT` env vars in `entrypoint.sh`, which configures `HTTP_PROXY` / `HTTPS_PROXY` for npm, yarn, pnpm, and Gradle.

---

## 6. Resource management

| Resource | Limit | Implementation |
|---|---|---|
| RAM | 4 GB | `--memory 4g` in `sandboxArgs()` |
| CPU | 2 vCPU | `--cpus 2` in `sandboxArgs()` |
| PID | 512 | `--pids-limit 512` |
| Workspace disk | 4 GB | Disk watchdog in `base.runtime.ts`, polls every 5 s |
| Build timeout | 25 min | `BUILD_TIMEOUT_MS` in `sandbox-config.ts` |
| /tmp tmpfs | 2 GB | `--tmpfs /tmp:rw,size=2g` |

The disk watchdog (`dirSize(projectPath)`) runs in a background interval and aborts the container if `MAX_WORKSPACE_BYTES` is exceeded.

---

## 7. Log handling & secret redaction

`redact-diagnose.ts` strips common secret patterns (API keys, tokens, PEM blocks) before logs reach the database. Test coverage: `redact-diagnose.test.cjs`.

---

## 8. APK preservation

Stage 6 (`06-output.ts`) copies the produced APK from the container workspace to the designated artifact store before workspace cleanup. The workspace is removed after successful artifact upload. This was verified by `artifacts.test.cjs` (73/73).

---

## 9. Docker context size

`.dockerignore` already excludes `**/node_modules`, `**/dist`, `**/out`, `.git`, `*.jks`, `*.keystore`, `uploads`, `keystores`, `e2e`, `examples`, `docs`, `scripts`, `*.log`, `*.tsbuildinfo`. The 4.44 GB context issue reported previously is addressed by these exclusions. No additional changes are required.

---

## 10. Summary of fixes applied during this audit

| ID | File | Change | Commit |
|---|---|---|---|
| AUD-01 | `worker/src/pipeline/stages/03-validate.ts` | `MAX_SUPPORTED_SDK` 35 → 37 | `808f7ad` |
| AUD-02 | `docker/egress-proxy/allowed-domains.txt` | Add `repo.reactnative.dev` | `808f7ad` |
| AUD-03 | `docker/android-builder/Dockerfile` | Add NDK 27.1.12297006 + CMake 3.22.1 | `808f7ad` |
| pre-audit | `docker/android-builder/Dockerfile` | Node 20→22.23.5, build-tools 36→37, add API 37 | `318ffea` |

All 73 tests pass on `808f7ad`.
