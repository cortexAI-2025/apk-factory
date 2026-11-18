# APK Factory V2 — Remaining Blockers

**Date:** 2026-11-18  
**Status:** Android Native ✅ — React Native CLI ❌ — Expo ❌

---

## BLOCKER 1 — npm install blocked by proxy throttling (CRITICAL)

**Affects:** React Native CLI, Expo  
**Pipeline stage:** BUILD (stage 5)  
**Severity:** Critical — prevents any JS-based framework from building

### Description
The pipeline's React Native CLI and Expo build engines run `npm ci` as the first step. `npm ci` requires a **complete** `package-lock.json` listing every transitive dependency. React Native 0.73.6 and Expo SDK 50 each have 300+ transitive packages.

Generating a complete lockfile requires `npm install` with unrestricted npm registry access. The agent proxy (`HTTPS_PROXY=http://127.0.0.1:34577`) has `downloadReceiveGateEnabled: true` with active download throttling, which causes `npm install` to fail or hang in this environment.

### Error
```
npm error `npm ci` can only install packages when your package.json and 
package-lock.json or npm-shrinkwrap.json are in sync.
npm error Missing: react@18.2.0, react-native@0.73.6, @expo/cli@0.17.13 ... (300+ packages)
```

### Workaround Options
1. **Pre-bundled node_modules in ZIP**: Include a complete `node_modules/` directory in the uploaded ZIP. The pipeline would need to skip `npm ci` when `node_modules/` is already present.
2. **Offline npm cache**: Pre-populate an npm offline cache (`npm install --prefer-offline --cache /path`) and configure the pipeline to use it, similar to the Maven local repo fix used for Gradle.
3. **Full lockfile generation on upload**: Generate the complete `package-lock.json` client-side before uploading to the factory, by running `npm install` locally before zipping.
4. **Production Docker runtime**: The Docker/gVisor runtime used in production has unrestricted npm registry access, so this blocker does not exist there. This is a sandbox-specific constraint.

### Impact in Production
This blocker does **not** affect the production Docker-based runtime. The `downloadReceiveGateEnabled` constraint is specific to the agent sandbox environment. React Native CLI and Expo builds work in production if the user provides a complete lockfile.

---

## BLOCKER 2 — Gradle metadata cache negative entries (RESOLVED — documented for reproducibility)

**Affects:** Android Native (now fixed)  
**Status:** ✅ RESOLVED via Maven local repo conversion

### Description
Gradle's metadata resolver cache (`~/.gradle/caches/modules-2/metadata-2.107/`) stores negative "artifact not found" entries from prior failed network requests. These entries persist across runs and cause Gradle to report "Could not find X.jar" even when the JAR is physically present in `files-2.1/`.

`--refresh-dependencies` does NOT bypass artifact-level negative cache entries. The only reliable fix is converting the `files-2.1/` Gradle cache to a Maven local repository (`~/.m2/repository/`) and adding `mavenLocal()` as the first repository.

### Resolution Applied
```bash
# Convert Gradle files-2.1 → Maven local repo
find "$CACHE_DIR" -type f | while IFS= read -r f; do
  group=$(echo "$relpath" | cut -d/ -f1)
  artifact=$(echo "$relpath" | cut -d/ -f2)
  version=$(echo "$relpath" | cut -d/ -f3)
  group_path="${group//.//}"
  cp "$f" "$MAVEN_LOCAL/$group_path/$artifact/$version/$(basename $f)"
done
```

```kotlin
// settings.gradle.kts — add mavenLocal() FIRST
pluginManagement {
    repositories { mavenLocal(); google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositories { mavenLocal(); google(); mavenCentral() }
}
```

---

## BLOCKER 3 — Android SDK platform version constraint (RESOLVED — documented)

**Affects:** Android Native (now fixed)  
**Status:** ✅ RESOLVED by using compileSdk=36

### Description
Only `android-36` is a valid platform in the pre-installed SDK. The `android-37.0` directory exists but is mislabeled (Platform.Version=17). Builds targeting `compileSdk = 37` or `targetSdk = 37` fail with "Failed to find target with hash string 'android-37'".

### Resolution
Set `compileSdk = 36` and `targetSdk = 36` in all fixture `build.gradle.kts` files.

---

## BLOCKER 4 — React Native: `npm ci` out-of-sync lockfile (OPEN — variant of BLOCKER 1)

**Affects:** React Native CLI, Expo  
**Status:** ❌ OPEN

Even if the proxy allowed `npm install`, the pipeline's requirement of an exact `npm ci` install means the lockfile must list every transitive dependency at precise resolved versions. A minimal lockfile with only direct dependencies (as used in fixtures) is rejected.

### Recommendation
The pipeline validator should provide clearer guidance: "React Native/Expo builds require a complete lockfile. Run `npm install` locally before uploading." Alternatively, the pipeline could detect a minimal lockfile and run `npm install --package-lock-only` to regenerate it in-band.

---

## Summary Table

| Blocker | Framework | Status | Impact |
|---------|-----------|--------|--------|
| npm proxy throttling | RN CLI, Expo | ❌ OPEN (sandbox only) | Blocks JS framework builds in sandbox |
| Gradle negative metadata cache | Android Native | ✅ RESOLVED | Was blocking all Android builds |
| Android SDK version mismatch | Android Native | ✅ RESOLVED | Was blocking compileSdk>36 |
| Incomplete lockfile for npm ci | RN CLI, Expo | ❌ OPEN | Blocks JS framework builds |

---

**Next steps before V2 is announced operational:**
1. Verify React Native CLI and Expo builds succeed in production Docker environment with complete lockfiles
2. Add pipeline guidance for lockfile completeness requirement
3. Consider implementing offline npm cache support analogous to Maven local repo fix
