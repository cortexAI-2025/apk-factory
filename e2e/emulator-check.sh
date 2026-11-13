#!/usr/bin/env bash
# Runs inside the Android emulator: install the downloaded APK, start it, check the expected screen.
set -euo pipefail
APK="${1:?usage: emulator-check.sh app-debug.apk [out-dir]}"
OUT="${2:-$(dirname "$APK")}"
mkdir -p "$OUT"
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
sleep 8

dump_ui() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  adb pull /sdcard/ui.xml "$OUT/ui-dump.xml" >/dev/null 2>&1 || true
}
# A slow, software-rendered CI emulator regularly shows "<system app> isn't responding" on top of the
# app. That is emulator noise, not the app: press "Wait" until nothing covers the app. The expected
# text is still required afterwards, so a real failure cannot slip through.
for i in 1 2 3 4 5 6; do
  dump_ui
  if grep -q "isn't responding" "$OUT/ui-dump.xml" 2>/dev/null; then
    echo "system ANR dialog detected (attempt $i): $(grep -o 'text="[^"]* isn'"'"'t responding"' "$OUT/ui-dump.xml" | head -1)"
    XY=$(grep -o 'text="Wait"[^>]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' "$OUT/ui-dump.xml" | head -1 \
      | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' \
      | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\1 \2 \3 \4/' \
      | awk '{printf "%d %d", ($1+$3)/2, ($2+$4)/2}')
    [ -n "$XY" ] && adb shell input tap $XY
    sleep 4
  else
    break
  fi
done
dump_ui
adb exec-out screencap -p > "$OUT/emulator-screen.png"
adb logcat -d > "$OUT/logcat.txt" || true
adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp" | tee "$OUT/focus.txt" || true

grep -q "text=\"$EXPECTED\"" "$OUT/ui-dump.xml" || { echo "::error::expected screen text not found: $EXPECTED"; cat "$OUT/ui-dump.xml" | head -c 2000; exit 1; }
grep -q "$PKG" "$OUT/focus.txt" || { echo "::error::app is not in the foreground"; exit 1; }
if grep -E "FATAL EXCEPTION|AndroidRuntime.*$PKG" "$OUT/logcat.txt"; then echo "::error::crash detected"; exit 1; fi
echo "✓ app started and shows: $EXPECTED"
