# APK Factory V2 — Artifact Manifest

**Date:** 2026-11-18  
**Policy:** Only real, pipeline-produced APKs are listed. Simulated, placeholder, or mock APKs are excluded.

---

## Verified Real APKs

### 1. Android Native Debug APK

| Field          | Value |
|----------------|-------|
| **File**       | `app-debug.apk` |
| **Local path** | `/tmp/apk-local-output/app-debug.apk` |
| **Size**       | 3,188,639 bytes (3.04 MB) |
| **SHA-256**    | `81c1278a34821ff9063924edbe0c565a0338c4107fec0d692eb1dfac7c2bbecc` |
| **applicationId** | `com.apkfactory.testapp` |
| **versionCode** | 1 |
| **versionName** | 1.0 |
| **minSdkVersion** | 24 |
| **targetSdkVersion** | 36 |
| **compileSdkVersion** | 36 |
| **Build type** | debug |
| **Signing** | APK Signature Scheme v2 (debug keystore) |
| **Build tool** | AGP 8.7.3 / Gradle 8.14.3 / Kotlin 2.0.21 |
| **Java** | OpenJDK 21 |
| **Pipeline** | 6/6 stages ✅ (EXTRACT→DETECT→VALIDATE→SCAN→BUILD→OUTPUT) |
| **Build time** | 31.1s (LocalRuntime, process isolation) |
| **Build ID**   | `local-build-1794989533501` |
| **Produced**   | 2026-11-18 |

---

## APKs NOT Listed (Blocked Builds)

| Framework         | Reason not listed |
|-------------------|--------------------|
| React Native CLI  | BUILD stage fails — `npm ci` requires complete lockfile (300+ transitive deps), network-blocked in sandbox |
| Expo (managed)    | BUILD stage fails — same npm ci constraint as React Native CLI |

---

## Verification Commands

```bash
# Verify SHA-256
sha256sum /tmp/apk-local-output/app-debug.apk
# Expected: 81c1278a34821ff9063924edbe0c565a0338c4107fec0d692eb1dfac7c2bbecc

# Inspect APK contents (requires aapt2 or apkanalyzer)
# aapt2 dump badging /tmp/apk-local-output/app-debug.apk

# Check signing
# apksigner verify --verbose /tmp/apk-local-output/app-debug.apk
```

---

**Total verified real APKs: 1 of 3 target frameworks**
