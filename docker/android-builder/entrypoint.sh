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

# ── Writable homes (root filesystem is read-only) ────────────────────────────
export HOME="${HOME:-/tmp/home}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-/tmp/android}"   # debug.keystore is generated here
mkdir -p "${HOME}" "${ANDROID_USER_HOME}"
export GRADLE_USER_HOME="/tmp/gradle-home"
mkdir -p "${GRADLE_USER_HOME}"

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
    echo "[entrypoint] Egress via allow-list proxy ${BUILD_PROXY_HOST}:${P}"
fi

echo "[entrypoint] Starting Gradle build..."
echo ""
exec "$@"
