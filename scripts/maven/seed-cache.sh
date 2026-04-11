#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# APK Factory — Maven Offline Cache Seeder
#
# Pre-downloads the most common Android/Kotlin/Gradle dependencies into
# a local Maven repository that is bind-mounted read-only into every
# build container. This makes --network=none builds 100% reliable.
#
# Usage:
#   bash scripts/maven/seed-cache.sh [--output /opt/apk-factory/maven-cache]
#
# Requires: Docker with internet access (run once during server setup)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

OUTPUT_DIR="${1:-${MAVEN_CACHE_DIR:-/opt/apk-factory/maven-cache}}"
ANDROID_SDK_VOL="${ANDROID_SDK_VOL:-android_sdk}"
GRADLE_CACHE_VOL="${GRADLE_CACHE_VOL:-gradle_cache}"
BUILDER_IMAGE="${BUILDER_IMAGE:-apk-factory/android-builder:latest}"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${CYAN}APK Factory — Maven Cache Seeder${NC}"
echo "Output: ${OUTPUT_DIR}"
echo ""

mkdir -p "${OUTPUT_DIR}"

# ── Temporary seed project ────────────────────────────────────────────────────
SEED_DIR="$(mktemp -d)"
trap 'rm -rf "${SEED_DIR}"' EXIT

echo -e "${CYAN}Creating seed project...${NC}"

# settings.gradle
cat > "${SEED_DIR}/settings.gradle" <<'GRADLE'
rootProject.name = 'seed'
include ':app'
GRADLE

# Root build.gradle — aggregates common plugins/versions
cat > "${SEED_DIR}/build.gradle" <<'GRADLE'
buildscript {
    ext {
        kotlin_version       = '1.9.22'
        agp_version          = '8.2.2'
    }
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath "com.android.tools.build:gradle:${agp_version}"
        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:${kotlin_version}"
    }
}
allprojects {
    repositories {
        google()
        mavenCentral()
        maven { url 'https://jitpack.io' }
    }
}
GRADLE

# gradle.properties
cat > "${SEED_DIR}/gradle.properties" <<'PROPS'
org.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8
org.gradle.parallel=true
org.gradle.caching=true
android.useAndroidX=true
kotlin.code.style=official
PROPS

# gradlew + wrapper
mkdir -p "${SEED_DIR}/gradle/wrapper"
cat > "${SEED_DIR}/gradle/wrapper/gradle-wrapper.properties" <<'PROPS'
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.2.1-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
PROPS

# Fake gradlew (will be replaced by the proper one in the builder)
printf '#!/bin/sh\nexec gradle "$@"\n' > "${SEED_DIR}/gradlew"
chmod +x "${SEED_DIR}/gradlew"

# app/build.gradle — comprehensive dependency list for pre-seeding
mkdir -p "${SEED_DIR}/app/src/main/java/com/seed"
cat > "${SEED_DIR}/app/build.gradle" <<'GRADLE'
plugins {
    id 'com.android.application'
    id 'kotlin-android'
}
android {
    compileSdkVersion 34
    defaultConfig {
        applicationId "com.seed.app"
        minSdkVersion 21
        targetSdkVersion 34
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release { minifyEnabled false }
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = '17' }
    namespace 'com.seed.app'
}
dependencies {
    // AndroidX core
    implementation 'androidx.core:core-ktx:1.12.0'
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.android.material:material:1.11.0'
    implementation 'androidx.constraintlayout:constraintlayout:2.1.4'
    implementation 'androidx.recyclerview:recyclerview:1.3.2'
    implementation 'androidx.cardview:cardview:1.0.0'
    implementation 'androidx.fragment:fragment-ktx:1.6.2'
    implementation 'androidx.activity:activity-ktx:1.8.2'

    // Lifecycle
    implementation 'androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0'
    implementation 'androidx.lifecycle:lifecycle-livedata-ktx:2.7.0'
    implementation 'androidx.lifecycle:lifecycle-runtime-ktx:2.7.0'

    // Navigation
    implementation 'androidx.navigation:navigation-fragment-ktx:2.7.7'
    implementation 'androidx.navigation:navigation-ui-ktx:2.7.7'

    // Room
    implementation 'androidx.room:room-runtime:2.6.1'
    implementation 'androidx.room:room-ktx:2.6.1'

    // Coroutines
    implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'
    implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3'

    // Networking
    implementation 'com.squareup.retrofit2:retrofit:2.9.0'
    implementation 'com.squareup.retrofit2:converter-gson:2.9.0'
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    implementation 'com.squareup.okhttp3:logging-interceptor:4.12.0'

    // Serialization
    implementation 'com.google.code.gson:gson:2.10.1'
    implementation 'org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2'

    // Image loading
    implementation 'io.coil-kt:coil:2.5.0'
    implementation 'com.github.bumptech.glide:glide:4.16.0'

    // Compose
    implementation platform('androidx.compose:compose-bom:2024.02.00')
    implementation 'androidx.compose.ui:ui'
    implementation 'androidx.compose.material3:material3'
    implementation 'androidx.compose.ui:ui-tooling-preview'
    implementation 'androidx.activity:activity-compose:1.8.2'

    // DI
    implementation 'com.google.dagger:hilt-android:2.50'

    // Firebase (common)
    implementation platform('com.google.firebase:firebase-bom:32.7.2')
    implementation 'com.google.firebase:firebase-analytics-ktx'
    implementation 'com.google.firebase:firebase-crashlytics-ktx'

    // Testing
    testImplementation 'junit:junit:4.13.2'
    androidTestImplementation 'androidx.test.ext:junit:1.1.5'
    androidTestImplementation 'androidx.test.espresso:espresso-core:3.5.1'
}
GRADLE

# Minimal source file
cat > "${SEED_DIR}/app/src/main/java/com/seed/MainActivity.kt" <<'KT'
package com.seed
class MainActivity
KT

# Minimal manifest
mkdir -p "${SEED_DIR}/app/src/main"
cat > "${SEED_DIR}/app/src/main/AndroidManifest.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="Seed" android:theme="@style/Theme.AppCompat">
        <activity android:name=".MainActivity" android:exported="true"/>
    </application>
</manifest>
XML

echo -e "${CYAN}Running seed build in Docker (network=host for downloads)...${NC}"
echo -e "${YELLOW}This will take 5-15 minutes on first run.${NC}"
echo ""

# Run the seed build with network access — this populates the Maven cache
docker run --rm \
    --name apk-factory-cache-seeder \
    --network host \
    --memory 4g \
    --cpus 4 \
    --volume "${OUTPUT_DIR}:/maven-cache:rw" \
    --volume "${ANDROID_SDK_VOL}:/opt/android-sdk:ro" \
    --volume "${SEED_DIR}:/workspace:rw" \
    --env ANDROID_HOME=/opt/android-sdk \
    --env GRADLE_OPTS="-Dorg.gradle.daemon=false -Xmx3072m -Dmaven.repo.local=/maven-cache" \
    --env GRADLE_USER_HOME=/tmp/gradle-home \
    --workdir /workspace \
    "${BUILDER_IMAGE}" \
    bash -c "
        chmod +x gradlew
        # Download all dependencies (don't actually build — just resolve)
        ./gradlew dependencies --no-daemon 2>&1 | tail -20 || true
        # Copy downloaded artifacts to the shared cache
        find /tmp/gradle-home/caches -name '*.jar' -o -name '*.aar' -o -name '*.pom' 2>/dev/null | \
            while read f; do
                REL=\$(echo \"\$f\" | sed 's|/tmp/gradle-home/caches/modules-2/files-2.1/||')
                DEST=\"/maven-cache/\$REL\"
                mkdir -p \"\$(dirname \"\$DEST\")\"
                cp -n \"\$f\" \"\$DEST\" 2>/dev/null || true
            done
        echo 'Cache population complete'
        ls /maven-cache | head -20
    "

echo ""
echo -e "${GREEN}✓ Maven cache populated: ${OUTPUT_DIR}${NC}"
echo -e "${GREEN}✓ $(du -sh "${OUTPUT_DIR}" | cut -f1) cached${NC}"
echo ""
echo "Add to .env:"
echo "  MAVEN_CACHE_DIR=${OUTPUT_DIR}"
