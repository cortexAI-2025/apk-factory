#!/usr/bin/env bash
# Builds the reference ZIPs deterministically from examples/reference-android.
#   examples/reference-android.zip         project at the archive root
#   examples/reference-android-nested.zip  project inside a single parent folder (GitHub style)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=examples/reference-android
OUT=examples
rm -f "$OUT/reference-android.zip" "$OUT/reference-android-nested.zip"
( cd "$SRC" && find . -type f ! -name README.md | sort | sed 's|^\./||' | zip -X -q "../reference-android.zip" -@ )
TMP=$(mktemp -d); mkdir "$TMP/reference-android-main"
( cd "$SRC" && find . -type f ! -name README.md | sort | sed 's|^\./||' | while read -r f; do mkdir -p "$TMP/reference-android-main/$(dirname "$f")"; cp -p "$f" "$TMP/reference-android-main/$f"; done )
( cd "$TMP" && find reference-android-main -type f | sort | zip -X -q "$OLDPWD/$OUT/reference-android-nested.zip" -@ )
rm -rf "$TMP"
sha256sum "$OUT"/reference-android*.zip
