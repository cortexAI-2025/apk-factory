#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# APK Factory — Build container entrypoint
#
# Runs as uid 1000 in a read-only sandbox (only /tmp and /workspace are writable).
# Prepares writable Gradle / Android homes, wires the egress proxy when the
# network is restricted, validates the workspace, then runs the Gradle command.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

WORKSPACE="${WORKSPACE:-/workspace}"
cd "${WORKSPACE}"

echo "[entrypoint] ──────────────────────────────────────────────────"
echo "[entrypoint] APK Factory build sandbox"
echo "[entrypoint] User      : $(id)"
echo "[entrypoint] Workspace : ${WORKSPACE}"
echo "[entrypoint] Java      : $(java -version 2>&1 | head -1)"
echo "[entrypoint] Command   : $*"
echo "[entrypoint] ──────────────────────────────────────────────────"

# ── Validate workspace ───────────────────────────────────────────────────────
# Multi-step engines (React Native CLI, Expo) run "npm ci" / "expo prebuild"
# *inside this container* before gradlew exists, possibly nested under
# android/ rather than at the workspace root — SKIP_GRADLE_PRECHECK=true is
# set by the worker (base.runtime.ts) only for those engines, never for a
# plain Android Native build.
if [ "${SKIP_GRADLE_PRECHECK:-}" != "true" ]; then
    if [ ! -f "${WORKSPACE}/gradlew" ]; then
        echo "[entrypoint] ERROR: gradlew not found in ${WORKSPACE}"
        exit 1
    fi
    if [ ! -f "${WORKSPACE}/build.gradle" ] && [ ! -f "${WORKSPACE}/build.gradle.kts" ] \
       && [ ! -f "${WORKSPACE}/settings.gradle" ] && [ ! -f "${WORKSPACE}/settings.gradle.kts" ]; then
        echo "[entrypoint] ERROR: No Gradle build file found in ${WORKSPACE}"
        exit 1
    fi
    chmod +x "${WORKSPACE}/gradlew" 2>/dev/null || true
else
    echo "[entrypoint] Gradle precheck skipped (SKIP_GRADLE_PRECHECK=true) — engine script prepares android/ itself"
fi

# ── Writable homes (root filesystem is read-only) ────────────────────────────
export HOME="${HOME:-/tmp/home}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-/tmp/android}"   # debug.keystore is generated here
mkdir -p "${HOME}" "${ANDROID_USER_HOME}"
export GRADLE_USER_HOME="/tmp/gradle-home"
mkdir -p "${GRADLE_USER_HOME}"
if [ -x /opt/flutter/bin/flutter ]; then
    export FLUTTER_HOME="${FLUTTER_HOME:-/opt/flutter}"
    export PATH="${FLUTTER_HOME}/bin:${PATH}"
    export PUB_CACHE="${PUB_CACHE:-/tmp/pub-cache}"
    mkdir -p "${PUB_CACHE}" "${HOME}/.config" "${HOME}/.flutter"
    # The image symlink bin/cache/lockfile -> /tmp/flutter-cache.lock.
    # A file bind-mount is EROFS under --read-only, so the target lives on tmpfs.
    if [ -L /opt/flutter/bin/cache/lockfile ]; then
        touch /tmp/flutter-cache.lock
        chmod 666 /tmp/flutter-cache.lock 2>/dev/null || true
    fi
    echo "[entrypoint] Flutter   : ${FLUTTER_HOME}"
fi

# ── Egress proxy (BUILD_NETWORK_MODE=restricted) ─────────────────────────────
if [ -n "${BUILD_PROXY_HOST:-}" ]; then
    P="${BUILD_PROXY_PORT:-3128}"
    PROXY_OPTS="-Dhttp.proxyHost=${BUILD_PROXY_HOST} -Dhttp.proxyPort=${P} -Dhttps.proxyHost=${BUILD_PROXY_HOST} -Dhttps.proxyPort=${P} -Dhttp.nonProxyHosts=localhost|127.0.0.1"
    export GRADLE_OPTS="${GRADLE_OPTS:-} ${PROXY_OPTS}"
    export JAVA_TOOL_OPTIONS="${PROXY_OPTS}"
    {
        echo "systemProp.http.proxyHost=${BUILD_PROXY_HOST}"
        echo "systemProp.http.proxyPort=${P}"
        echo "systemProp.https.proxyHost=${BUILD_PROXY_HOST}"
        echo "systemProp.https.proxyPort=${P}"
        echo "systemProp.http.nonProxyHosts=localhost|127.0.0.1"
        echo "org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8 ${PROXY_OPTS}"
    } >> "${GRADLE_USER_HOME}/gradle.properties"
    # npm/yarn/pnpm (React Native / Expo engines) read these standard vars —
    # lower-case forms too, since some tools only check the lower-case name.
    export HTTP_PROXY="http://${BUILD_PROXY_HOST}:${P}"
    export HTTPS_PROXY="http://${BUILD_PROXY_HOST}:${P}"
    export http_proxy="${HTTP_PROXY}"
    export https_proxy="${HTTPS_PROXY}"
    export NO_PROXY="localhost,127.0.0.1"
    export no_proxy="${NO_PROXY}"
    echo "[entrypoint] Egress via allow-list proxy ${BUILD_PROXY_HOST}:${P}"
fi

echo "[entrypoint] Starting Gradle build..."
echo ""
exec "$@"
