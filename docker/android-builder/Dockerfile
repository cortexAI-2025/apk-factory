# APK Factory - Android Build Environment
# Provides Android SDK + Gradle for isolated APK builds

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH="${JAVA_HOME}/bin:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"
ENV GRADLE_OPTS="-Dorg.gradle.daemon=false -Xmx2048m"

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk \
    wget \
    unzip \
    git \
    curl \
    ca-certificates \
    lib32stdc++6 \
    lib32z1 \
    && rm -rf /var/lib/apt/lists/*

# Android SDK Command Line Tools
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools && \
    wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/cmdline-tools.zip && \
    unzip -q /tmp/cmdline-tools.zip -d ${ANDROID_HOME}/cmdline-tools && \
    mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest && \
    rm /tmp/cmdline-tools.zip

# Accept licenses and install SDK packages
RUN yes | sdkmanager --licenses > /dev/null 2>&1 && \
    sdkmanager \
        "platform-tools" \
        "platforms;android-34" \
        "platforms;android-33" \
        "platforms;android-32" \
        "platforms;android-31" \
        "platforms;android-30" \
        "build-tools;34.0.0" \
        "build-tools;33.0.2" \
        "build-tools;32.0.0" \
        "build-tools;31.0.0" \
        "build-tools;30.0.3"

# Pre-download common Gradle versions to speed up builds
RUN for VERSION in 8.2 8.1 8.0 7.6.3 7.5.1 7.4.2 7.3.3 6.9.4; do \
      mkdir -p /root/.gradle/wrapper/dists/gradle-${VERSION}-bin && \
      wget -q https://services.gradle.org/distributions/gradle-${VERSION}-bin.zip \
          -O /root/.gradle/wrapper/dists/gradle-${VERSION}-bin/gradle-${VERSION}-bin.zip || true; \
    done

# Gradle user home
ENV GRADLE_USER_HOME=/root/.gradle

# Working directory for builds
WORKDIR /workspace

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD java -version && sdkmanager --list_installed | head -5

CMD ["/bin/bash"]
