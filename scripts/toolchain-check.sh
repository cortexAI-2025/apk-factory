#!/bin/bash
# Runs INSIDE the builder image. Checks only what the requested frameworks compile with:
#   toolchain-check.sh <comma-separated frameworks>   e.g. java,kotlin  |  flutter
# Flutter is verified (strictly) only when `flutter` is in the list, so a Flutter problem
# can never mask or fail the other frameworks. No check is ever skipped for a framework
# that needs it.
set -euo pipefail
FW=",${1:-java,kotlin,flutter,react-native,expo,capacitor,cordova},"
has() { [[ "$FW" == *",$1,"* ]]; }
echo "== java =="; java -version
echo "== android sdk =="; ls /opt/android-sdk/platforms /opt/android-sdk/build-tools
if has capacitor || has cordova || has react-native || has expo; then
  echo "== ndk =="; ls /opt/android-sdk/ndk
fi
echo "== gradle =="; gradle -version
if has expo || has react-native || has capacitor || has cordova; then
  echo "== node =="; node -v; npm -v
fi
if has flutter; then
  echo "== flutter =="; flutter-health; flutter --version
else
  echo "== flutter == (not required by: ${1:-})"
fi
