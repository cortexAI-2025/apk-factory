#!/usr/bin/env bash
# Runs inside the Android emulator: install the downloaded APK, start it, check the expected screen.
set -euo pipefail
APK="${1:?usage: emulator-check.sh app-debug.apk [out-dir]}"
OUT="${2:-$(dirname "$APK")}"
PKG=com.apkfactory.reference
EXPECTED="APK Factory Reference OK"

adb wait-for-device
adb shell getprop ro.build.version.sdk | tr -d '\r' | sed 's/^/emulator API level: /'
adb install -r "$APK"
adb shell pm list packages | grep -q "package:$PKG" || { echo "::error::package not installed"; exit 1; }
echo "✓ installed $PKG"

adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity" | tee "$OUT/am-start.txt"
grep -q "Status: ok" "$OUT/am-start.txt" || { echo "::error::activity did not start"; exit 1; }
sleep 4

adb shell uiautomator dump /sdcard/ui.xml >/dev/null
adb pull /sdcard/ui.xml "$OUT/ui-dump.xml" >/dev/null
adb exec-out screencap -p > "$OUT/emulator-screen.png"
adb logcat -d > "$OUT/logcat.txt" || true
adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp" | tee "$OUT/focus.txt" || true

grep -q "text=\"$EXPECTED\"" "$OUT/ui-dump.xml" || { echo "::error::expected screen text not found: $EXPECTED"; cat "$OUT/ui-dump.xml" | head -c 2000; exit 1; }
grep -q "$PKG" "$OUT/focus.txt" || { echo "::error::app is not in the foreground"; exit 1; }
if grep -E "FATAL EXCEPTION|AndroidRuntime.*$PKG" "$OUT/logcat.txt"; then echo "::error::crash detected"; exit 1; fi
echo "✓ app started and shows: $EXPECTED"
