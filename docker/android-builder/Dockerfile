# ─────────────────────────────────────────────────────────────────────────────
# APK Factory — Android Build Sandbox
#
# Security hardening:
#   - Runs as non-root user 'builder' (uid 1000)
#   - Minimal package set (no curl, wget, ssh in runtime)
#   - Android SDK and Gradle cache are read-only bind mounts at runtime
#   - No network access during builds (--network=none in docker run)
# ─────────────────────────────────────────────────────────────────────────────
FROM ubuntu:22.04 AS base

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# ── System dependencies (build stage only tools) ─────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        openjdk-17-jdk-headless \
        wget \
        unzip \
        git \
        ca-certificates \
        lib32stdc++6 \
        lib32z1 \
        # zipalign + apksigner deps
        libgcc-s1 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# ── Android SDK paths ─────────────────────────────────────────────────────────
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

ENV PATH="${JAVA_HOME}/bin:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools/37.0.0:${PATH}"

# ── Install Android SDK Command-Line Tools ────────────────────────────────────
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools \
    && wget -q \
        https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
        -O /tmp/cmdline-tools.zip \
    && unzip -q /tmp/cmdline-tools.zip -d ${ANDROID_HOME}/cmdline-tools \
    && mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest \
    && rm /tmp/cmdline-tools.zip

# ── Accept SDK licenses & install packages ────────────────────────────────────
RUN yes | sdkmanager --licenses > /dev/null 2>&1 || true \
    && sdkmanager \
        "platform-tools" \
        "platforms;android-37.0" \
        "platforms;android-36" \
        "platforms;android-35" \
        "platforms;android-34" \
        "platforms;android-33" \
        "platforms;android-32" \
        "platforms;android-31" \
        "platforms;android-30" \
        "platforms;android-29" \
        "build-tools;37.0.0" \
        "build-tools;36.0.0" \
        "build-tools;35.0.0" \
        "build-tools;34.0.0" \
        "build-tools;33.0.2" \
        "build-tools;32.0.0" \
        "build-tools;30.0.3" \
        "ndk;27.1.12297006" \
        "cmake;3.22.1" \
    && chmod -R o+rX ${ANDROID_HOME}

# The Gradle distribution requested by the project's wrapper is downloaded at build
# time through the egress proxy (services.gradle.org is on the allow-list).
ENV GRADLE_USER_HOME=/opt/gradle-home
RUN mkdir -p ${GRADLE_USER_HOME}

# ── Node.js (for React Native / Expo engines) ─────────────────────────────────
# Pinned version, checksum-verified against Node's own published SHASUMS256.txt
# at image-build time (not a runtime download — never fetched during a build).
# Node 22.x LTS ("Jod"): required by RN 0.80+ (engines: "node >= 22.11.0") and
# Expo SDK 53+. Pinned to a specific patch release; bump together with the RN
# and Expo baselines the factory targets.
ENV NODE_VERSION=22.23.5
RUN set -eux; \
    ARCH="$(dpkg --print-architecture)"; \
    case "${ARCH}" in \
        amd64) NODE_ARCH=x64 ;; \
        arm64) NODE_ARCH=arm64 ;; \
        *) echo "unsupported architecture: ${ARCH}" >&2; exit 1 ;; \
    esac; \
    wget -q "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -O /tmp/node.tar.xz; \
    wget -q "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -O /tmp/node-SHASUMS256.txt; \
    grep " node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz\$" /tmp/node-SHASUMS256.txt | sha256sum -c -; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1; \
    rm -f /tmp/node.tar.xz /tmp/node-SHASUMS256.txt

# npm ships with Node; pin pnpm/yarn via Corepack (no unversioned global CLI —
# "npx expo"/"npx pnpm"/"yarn" always resolve the project's own declared
# version, falling back to these pins only when a project's lockfile/
# packageManager field doesn't specify one).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable \
    && corepack prepare pnpm@9.12.3 --activate \
    && corepack prepare yarn@1.22.22 --activate

# ── Flutter SDK (stable 3.50.1, precached for Android) ───────────────────────
# The sandbox root filesystem is read-only at build time, so the engine stamp
# script must exit when bin/cache is not writable and the stamp already exists.
ENV FLUTTER_HOME=/opt/flutter \
    FLUTTER_VERSION=3.50.1
ENV PATH="/usr/local/bin:${FLUTTER_HOME}/bin:${PATH}"
RUN printf '%s\n' '#!/bin/sh' 'exec /usr/bin/tar --no-same-owner "$@"' > /usr/local/bin/tar \
    && chmod +x /usr/local/bin/tar \
    && git clone --depth 1 --branch ${FLUTTER_VERSION} https://github.com/flutter/flutter.git ${FLUTTER_HOME} \
    && git config --system --add safe.directory ${FLUTTER_HOME} \
    && ${FLUTTER_HOME}/bin/flutter config --no-analytics --no-cli-animations \
    && ${FLUTTER_HOME}/bin/flutter precache --android
COPY docker/android-builder/patch-flutter-readonly.js /tmp/patch-flutter-readonly.js
RUN node /tmp/patch-flutter-readonly.js \
    && rm /tmp/patch-flutter-readonly.js \
    && chmod -R a+rX ${FLUTTER_HOME}

# ── Non-root user ─────────────────────────────────────────────────────────────
RUN groupadd -g 1000 builder \
    && useradd -u 1000 -g builder -m -s /bin/bash builder \
    # Give builder access to Android SDK (read-only mount will override at runtime)
    && chown -R builder:builder ${GRADLE_USER_HOME}

# ── Entrypoint ────────────────────────────────────────────────────────────────
COPY docker/android-builder/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /workspace
USER builder

ENV GRADLE_OPTS="-Dorg.gradle.daemon=false -Xmx2048m -Dfile.encoding=UTF-8 -Dorg.gradle.parallel=false" \
    TERM=dumb \
    CI=true \
    # Point Gradle home to pre-seeded location (read-only at runtime)
    GRADLE_USER_HOME=/opt/gradle-home

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["./gradlew", "assembleDebug", "--no-daemon", "--stacktrace", "--console=plain"]
