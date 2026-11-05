#!/usr/bin/env bash
# Verifies the downloaded debug APK: valid signature (debug key), package, SDK levels.
set -euo pipefail
APK="${1:?usage: verify-apk.sh app-debug.apk}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
echo "build-tools: $BT"
OUT=$("$BT/apksigner" verify --verbose --print-certs "$APK" 2>&1) || { echo "$OUT"; echo "::error::apksigner verification failed"; exit 1; }
echo "$OUT"
echo "$OUT" | grep -q "Verifies" || { echo "::error::APK does not verify"; exit 1; }
echo "$OUT" | grep -Eq "Verified using v2 scheme \(APK Signature Scheme v2\): true" || { echo "::error::no v2 signature"; exit 1; }
echo "$OUT" | grep -q "CN=Android Debug" || { echo "::error::APK is not signed with the Android debug certificate"; exit 1; }
BADGING=$("$BT/aapt2" dump badging "$APK")
echo "$BADGING" | grep -E "^package:|sdkVersion|targetSdkVersion|application-label:|launchable-activity" 
echo "$BADGING" | grep -q "name='com.apkfactory.reference'" || { echo "::error::unexpected package"; exit 1; }
echo "✓ debug-signed APK, package com.apkfactory.reference"
