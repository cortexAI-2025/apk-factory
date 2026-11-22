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
    cd /tmp; \
    wget -q "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz"; \
    wget -q "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xzf "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" -C /usr/local --strip-components=1; \
    rm -f "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" SHASUMS256.txt

# npm ships with Node; pin pnpm/yarn via Corepack (no unversioned global CLI —
# "npx expo"/"npx pnpm"/"yarn" always resolve the project's own declared
# version, falling back to these pins only when a project's lockfile/
# packageManager field doesn't specify one).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable \
    && corepack prepare pnpm@9.12.3 --activate \
    && corepack prepare yarn@1.22.22 --activate

# Cordova's platform tooling shells out to a system `gradle` to install the
# project wrapper (cordova-android check_reqs). The wrapper alone is not enough.
ENV GRADLE_VERSION=8.7
RUN wget -q "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -O /tmp/gradle.zip \
    && unzip -q /tmp/gradle.zip -d /opt \
    && chmod +x "/opt/gradle-${GRADLE_VERSION}/bin/gradle" \
    && ln -sfn "/opt/gradle-${GRADLE_VERSION}/bin/gradle" /usr/local/bin/gradle \
    && rm /tmp/gradle.zip

# Flutter's first run downloads the Dart SDK with curl. wget is not accepted.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# ── Flutter SDK (stable 3.50.1, precached for Android) ───────────────────────
# The sandbox root filesystem is read-only at build time, so the engine stamp
# script must exit when bin/cache is not writable and the stamp already exists.
ENV FLUTTER_HOME=/opt/flutter \
    FLUTTER_VERSION=3.50.1
ENV PATH="/usr/local/bin:${FLUTTER_HOME}/bin:${PATH}"
RUN printf '%s\n' \
      '#!/bin/sh' \
      '# --no-same-owner must come before the operation. Traditional "tar czf" has no leading dash.' \
      'if [ -n "$1" ] && [ "${1#-}" = "$1" ]; then' \
      '  op=$1' \
      '  shift' \
      '  set -- -"$op" "$@"' \
      'fi' \
      'exec /usr/bin/tar --no-same-owner "$@"' \
      > /usr/local/bin/tar \
    && chmod +x /usr/local/bin/tar \
    && git clone --depth 1 --branch ${FLUTTER_VERSION} https://github.com/flutter/flutter.git ${FLUTTER_HOME} \
    && git config --system --add safe.directory ${FLUTTER_HOME} \
    && CI=true ${FLUTTER_HOME}/bin/flutter config --no-analytics --no-cli-animations \
    && CI=true ${FLUTTER_HOME}/bin/flutter precache --android
COPY docker/android-builder/patch-flutter-readonly.js /tmp/patch-flutter-readonly.js
RUN node /tmp/patch-flutter-readonly.js \
    && rm /tmp/patch-flutter-readonly.js \
    && chmod -R a+rX ${FLUTTER_HOME} \
    && rm -f ${FLUTTER_HOME}/bin/cache/lockfile \
    && ln -s /tmp/flutter-cache.lock ${FLUTTER_HOME}/bin/cache/lockfile \
    # Make sure the tool snapshot and its stamp exist as REAL files before they are moved
    # to the seed: a missing flutter_tools.stamp makes Flutter rebuild (and write) at start.
    && ${FLUTTER_HOME}/bin/flutter --version \
    && test -s ${FLUTTER_HOME}/bin/cache/flutter_tools.stamp \
    && test -f ${FLUTTER_HOME}/bin/cache/flutter_tools.snapshot \
    && mkdir -p /opt/flutter-stamps \
    && cd ${FLUTTER_HOME}/bin/cache \
    && for s in *.stamp; do \
         [ -e "$s" ] || continue; \
         if [ ! -L "$s" ]; then mv "$s" "/opt/flutter-stamps/$s"; fi; \
         ln -sfn "/tmp/flutter-stamps/$s" "$s"; \
       done \
    && for name in libimobiledevice libusbmuxd libplist openssl libimobiledeviceglue ios-deploy \
         material_fonts flutter_web_sdk engine_stamp flutter_sdk gradle_wrapper \
         android-sdk android-internal-build-artifacts font-subset flutter_version_check \
         engine engine-dart-sdk; do \
         if [ ! -e "${name}.stamp" ] && [ ! -L "${name}.stamp" ]; then ln -s "/tmp/flutter-stamps/${name}.stamp" "${name}.stamp"; fi; \
       done

# Stamps and the lockfile are symlinks into /tmp (empty in every fresh container). The
# wrappers below seed them on every invocation, so `flutter`/`dart` work from any entry
# point, not only through entrypoint.sh. Real SDK binaries are called by absolute path.
COPY docker/android-builder/flutter-bootstrap.sh docker/android-builder/flutter-health.sh /usr/local/lib/apk-factory/
COPY docker/android-builder/flutter-wrapper.sh /usr/local/lib/apk-factory/flutter-wrapper.sh
RUN chmod 755 /usr/local/lib/apk-factory/*.sh \
    && ln -sf /usr/local/lib/apk-factory/flutter-wrapper.sh /usr/local/bin/flutter \
    && ln -sf /usr/local/lib/apk-factory/flutter-wrapper.sh /usr/local/bin/dart \
    && ln -sf /usr/local/lib/apk-factory/flutter-health.sh /usr/local/bin/flutter-health

# ── Non-root user ─────────────────────────────────────────────────────────────
RUN groupadd -g 1000 builder \
    && useradd -u 1000 -g builder -m -s /bin/bash builder \
    # Give builder access to Android SDK (read-only mount will override at runtime)
    && chown -R builder:builder ${GRADLE_USER_HOME}

# ── Flutter health gate: the image build fails if the SDK is incomplete ──────
# Checked as root and as the unprivileged user that runs builds (fresh /tmp each time).
# /tmp is emptied before each check: every check must start from the fresh state a new
# container has, so one check cannot hide what another left behind.
RUN rm -rf /tmp/flutter-stamps /tmp/flutter-cache.lock \
    && FLUTTER_VERSION=${FLUTTER_VERSION} flutter-health \
    && rm -rf /tmp/flutter-stamps /tmp/flutter-cache.lock \
    && su builder -c "FLUTTER_HOME=${FLUTTER_HOME} FLUTTER_VERSION=${FLUTTER_VERSION} /usr/local/bin/flutter-health" \
    # Leave /tmp as a fresh container expects it: files left by the builder check would be
    # unwritable by root at run time (fs.protected_regular on sticky /tmp).
    && rm -rf /tmp/flutter-stamps /tmp/flutter-cache.lock

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
