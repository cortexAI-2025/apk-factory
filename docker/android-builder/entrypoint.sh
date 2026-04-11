#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# APK Factory — Build container entrypoint
#
# Runs as non-root 'builder' user inside a read-only sandbox.
# Validates the workspace before executing the Gradle command.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

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

if [ ! -f "${WORKSPACE}/build.gradle" ] && [ ! -f "${WORKSPACE}/build.gradle.kts" ]; then
    echo "[entrypoint] ERROR: No build.gradle found in ${WORKSPACE}"
    exit 1
fi

# Ensure gradlew is executable (it's in a rw volume)
chmod +x "${WORKSPACE}/gradlew" 2>/dev/null || true

# ── Gradle wrapper distribution check ────────────────────────────────────────
# If the declared Gradle version is pre-seeded, unzip it into the rw cache area
PROPS="${WORKSPACE}/gradle/wrapper/gradle-wrapper.properties"
if [ -f "${PROPS}" ]; then
    GRADLE_URL=$(grep distributionUrl "${PROPS}" | cut -d= -f2- | tr -d '\r\n\\')
    GRADLE_VER=$(echo "${GRADLE_URL}" | grep -oP 'gradle-\K[\d.]+(?=-bin)')
    CACHED_ZIP="${GRADLE_USER_HOME}/wrapper/dists/gradle-${GRADLE_VER}-bin/gradle-${GRADLE_VER}-bin.zip"

    if [ -n "${GRADLE_VER}" ] && [ -f "${CACHED_ZIP}" ]; then
        echo "[entrypoint] Using cached Gradle ${GRADLE_VER}"
        # Create the writable Gradle installation dir in /tmp
        INSTALL_DIR="/tmp/gradle-dists/gradle-${GRADLE_VER}-bin"
        mkdir -p "${INSTALL_DIR}"
        # Copy zip to writable location so the wrapper can unzip it
        cp "${CACHED_ZIP}" "${INSTALL_DIR}/"
        # Override GRADLE_USER_HOME to writable location
        export GRADLE_USER_HOME="/tmp/gradle-home"
        mkdir -p "${GRADLE_USER_HOME}/wrapper/dists/gradle-${GRADLE_VER}-bin"
        cp "${CACHED_ZIP}" "${GRADLE_USER_HOME}/wrapper/dists/gradle-${GRADLE_VER}-bin/"
    else
        echo "[entrypoint] WARNING: Gradle ${GRADLE_VER:-unknown} not in cache"
        echo "[entrypoint] Network is disabled — build may fail if Gradle must download"
        export GRADLE_USER_HOME="/tmp/gradle-home"
        mkdir -p "${GRADLE_USER_HOME}"
    fi
fi

# ── Build output dir ──────────────────────────────────────────────────────────
# /workspace is rw so Gradle can write build/ outputs there

echo "[entrypoint] Starting Gradle build..."
echo ""

# Execute the Gradle command passed by the worker
exec "$@"
