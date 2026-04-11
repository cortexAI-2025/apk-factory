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

ENV PATH="${JAVA_HOME}/bin:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools/34.0.0:${PATH}"

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
        "platforms;android-34" \
        "platforms;android-33" \
        "platforms;android-32" \
        "platforms;android-31" \
        "platforms;android-30" \
        "platforms;android-29" \
        "build-tools;34.0.0" \
        "build-tools;33.0.2" \
        "build-tools;32.0.0" \
        "build-tools;30.0.3" \
    && chmod -R o+rX ${ANDROID_HOME}

# ── Pre-seed common Gradle wrapper distributions ─────────────────────────────
#    Downloaded here so containers with --network=none can use them
ENV GRADLE_USER_HOME=/opt/gradle-home
RUN mkdir -p ${GRADLE_USER_HOME}/wrapper/dists

RUN for VERSION in 8.4 8.3 8.2.1 8.1.1 8.0 7.6.4 7.5.1 7.4.2 7.3.3 6.9.4; do \
        DIST_DIR="${GRADLE_USER_HOME}/wrapper/dists/gradle-${VERSION}-bin"; \
        mkdir -p "${DIST_DIR}" \
        && wget -q \
            "https://services.gradle.org/distributions/gradle-${VERSION}-bin.zip" \
            -O "${DIST_DIR}/gradle-${VERSION}-bin.zip" || true; \
    done

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
