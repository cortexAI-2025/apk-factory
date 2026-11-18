# APK Factory V2 — Real Build Report

**Date:** 2026-11-18  
**Scope:** Validation of the universal Android build engine via full 6-stage pipeline (EXTRACT → DETECT → VALIDATE → SCAN → BUILD → OUTPUT) using LocalRuntime on host.

---

## Summary

| Framework         | Stages passed    | Verdict  | Real APK? |
|-------------------|------------------|----------|-----------|
| Android Native    | 6/6              | ✅ PASS  | Yes       |
| React Native CLI  | 4/6 (fails at 5) | ❌ FAIL  | No        |
| Expo (prebuild)   | 4/6 (fails at 5) | ❌ FAIL  | No        |

**APK Factory V2 is NOT yet announced as fully operational.** Only the Android Native path has been demonstrated with a real, verified APK. React Native CLI and Expo builds are blocked by a network constraint described below.

---

## 1. Android Native — ✅ FULL SUCCESS

### Pipeline Run
- **Build ID:** `local-build-1794989533501`
- **Input:** `android-native-fixture.zip` (Kotlin DSL, compileSdk/targetSdk=36, AGP 8.7.3)
- **Total time:** 31.1s
- **Runtime:** `local` (process isolation, no Docker)

### Stage Results
| Stage    | Duration | Result |
|----------|----------|--------|
| EXTRACT  | 0.0s     | ✅ OK  |
| DETECT   | 0.0s     | ✅ OK — ANDROID_NATIVE (confidence 100%) |
| VALIDATE | 0.0s     | ✅ OK — compileSdk 36 in supported range |
| SCAN     | 0.0s     | ✅ OK — no threats, 10 files, 4 KB |
| BUILD    | 31.0s    | ✅ OK — BUILD SUCCESSFUL, 33 tasks |
| OUTPUT   | 0.1s     | ✅ OK — 1 debug APK, 3.04 MB |

### APK Artifact
- **Path:** `/tmp/apk-local-output/app-debug.apk`
- **Size:** 3,188,639 bytes (3.04 MB)
- **SHA-256:** `81c1278a34821ff9063924edbe0c565a0338c4107fec0d692eb1dfac7c2bbecc`
- **applicationId:** `com.apkfactory.testapp`
- **versionCode:** 1, **versionName:** 1.0
- **minSdk:** 24, **targetSdk:** 36, **compileSdk:** 36
- **Signing:** APK Signature Scheme v2 (debug keystore)

### Key Fix Applied to Fixture
The Android SDK dependency cache (`~/.gradle/caches/modules-2/files-2.1/`) contained all required JARs (268 POMs, 160 JARs) but Gradle's metadata resolver (`metadata-2.107/`) had stale negative entries from prior failed runs. The fix:
1. Converted `files-2.1/` Gradle cache format → Maven local repo (`~/.m2/repository/`, 1036 files)
2. Added `mavenLocal()` as first repository in both `pluginManagement.repositories` and `dependencyResolutionManagement.repositories` in `settings.gradle.kts`
3. Deleted the stale `metadata-2.107/` before the build run

This bypasses Gradle's broken metadata resolver entirely by routing through the Maven local repo path.

---

## 2. React Native CLI — ❌ FAIL at BUILD (stage 5/6)

### Pipeline Run
- **Input:** `rn-fixture2.zip` (RN 0.73.6, android/ subdir present, AGP 8.7.3)
- **Framework detected:** REACT_NATIVE_CLI (confidence 75%)
- **Failure stage:** BUILD

### Stage Results
| Stage    | Duration | Result |
|----------|----------|--------|
| EXTRACT  | 0.0s     | ✅ OK  |
| DETECT   | 0.0s     | ✅ OK — REACT_NATIVE_CLI |
| VALIDATE | 0.0s     | ✅ OK — package-lock.json found |
| SCAN     | 0.0s     | ✅ OK  |
| BUILD    | 0.3s     | ❌ FAIL — npm ci: missing 18+ packages from lockfile |
| OUTPUT   | —        | skipped |

### Root Cause
The pipeline's React Native build engine runs `npm ci` as the first step. `npm ci` requires a **complete** `package-lock.json` listing all transitive dependencies. A React Native 0.73.6 project has 300+ transitive packages. Generating a full lockfile requires `npm install` which needs unrestricted npm registry access.

**Blocker:** The agent proxy (`HTTPS_PROXY=http://127.0.0.1:34577`) has `downloadReceiveGateEnabled: true` and active download throttling. While `registry.npmjs.org` is in the Java `nonProxyHosts` list, npm itself routes through the proxy and encounters rate-limiting/gating that makes a full `npm install` unreliable in this environment.

### Error Output
```
npm error `npm ci` can only install packages when your package.json and 
package-lock.json or npm-shrinkwrap.json are in sync.
npm error Missing: react@18.2.0, react-native@0.73.6, @react-native-community/cli@12.3.6 ... (18+ packages)
```

---

## 3. Expo (Managed Workflow + Local Prebuild) — ❌ FAIL at BUILD (stage 5/6)

### Pipeline Run
- **Input:** `expo-fixture.zip` (Expo SDK ~50.0.14, android/ subdir present from local prebuild, AGP 8.7.3)
- **Framework detected:** EXPO (via app.json `expo.android.package`)
- **Failure stage:** BUILD

### Stage Results
| Stage    | Duration | Result |
|----------|----------|--------|
| EXTRACT  | 0.0s     | ✅ OK  |
| DETECT   | 0.0s     | ✅ OK — EXPO |
| VALIDATE | 0.0s     | ✅ OK — android/ present, prebuild skipped |
| SCAN     | 0.0s     | ✅ OK  |
| BUILD    | 0.3s     | ❌ FAIL — npm ci: missing 18+ packages from lockfile |
| OUTPUT   | —        | skipped |

### Root Cause
Identical to React Native CLI. The Expo build engine also runs `npm ci` first. The Expo SDK 50 dependency tree requires `expo@50.0.21`, `@expo/cli@0.17.13`, and 300+ transitive packages. Full lockfile generation requires unrestricted npm registry access.

**Note:** The Expo path correctly recognizes that `android/` is already present and skips `expo prebuild` (VALIDATE log: `✓ android/ already present — expo prebuild will be skipped`). The blocker is exclusively the npm install step.

---

## 4. Test Suite

All 73 existing worker unit/integration tests pass after LocalRuntime addition:
```
# tests 73 / pass 73 / fail 0
```

---

## 5. Environment Constraints Discovered

| Constraint | Impact |
|-----------|--------|
| `downloadReceiveGateEnabled: true` on proxy | npm install blocked; Gradle artifact downloads throttled |
| Gradle metadata cache (`metadata-2.107/`) negative entries | Gradle can't locate cached JARs even when present in `files-2.1/` |
| Android SDK: only `android-36` valid (android-37.0 is mislabeled) | compileSdk/targetSdk must be ≤36 |
| No Docker available on this host | LocalRuntime (process isolation) is the only viable runtime |
| Java trust store: `/etc/ssl/certs/java/cacerts` | Required for Gradle HTTPS via proxy CA |

---

## 6. Conclusion

APK Factory V2's Android Native pipeline is **fully functional** for projects that use pure Gradle (no npm/yarn pre-step). The React Native CLI and Expo paths are blocked by the same npm dependency installation constraint in this sandboxed environment. This constraint does not exist in production Docker-based deployments (gVisor/Docker runtimes) where npm registry access is unrestricted.

**APK Factory V2 is NOT announced as fully operational** until all three real compilations are demonstrated. Only Android Native has been verified.
