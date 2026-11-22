#!/bin/sh
# Prepares the writable side of the Flutter SDK. Safe to run any number of times,
# as any user, from any entry point (entrypoint.sh, the `flutter`/`dart` wrappers,
# `docker run --entrypoint bash ...`).
#
# Why this exists: in the image bin/cache/*.stamp and bin/cache/lockfile are symlinks
# into /tmp, because the sandbox root filesystem is read-only at run time. /tmp is
# empty in every fresh container, so those links dangle until they are seeded from the
# copies kept in /opt/flutter-stamps. Without seeding, Flutter fails with
# ".../bin/cache/engine-dart-sdk.stamp: No such file or directory".
#
# Overridable for tests: FLUTTER_HOME, FLUTTER_STAMP_SEED, FLUTTER_STAMP_DIR, FLUTTER_LOCK_FILE.
FLUTTER_HOME="${FLUTTER_HOME:-/opt/flutter}"
FLUTTER_STAMP_SEED="${FLUTTER_STAMP_SEED:-/opt/flutter-stamps}"
FLUTTER_STAMP_DIR="${FLUTTER_STAMP_DIR:-/tmp/flutter-stamps}"
FLUTTER_LOCK_FILE="${FLUTTER_LOCK_FILE:-/tmp/flutter-cache.lock}"

mkdir -p "$FLUTTER_STAMP_DIR" 2>/dev/null || true
if [ -d "$FLUTTER_STAMP_SEED" ]; then
  # -n: never overwrite a stamp Flutter already refreshed during this container's life.
  cp -an "$FLUTTER_STAMP_SEED"/. "$FLUTTER_STAMP_DIR"/ 2>/dev/null || true
fi
chmod -R a+rwX "$FLUTTER_STAMP_DIR" 2>/dev/null || true
if [ -L "$FLUTTER_HOME/bin/cache/lockfile" ]; then
  # touch, not `: >>`: a failed redirection on a special builtin aborts a POSIX sh script.
  touch "$FLUTTER_LOCK_FILE" 2>/dev/null || true
  chmod 666 "$FLUTTER_LOCK_FILE" 2>/dev/null || true
fi
