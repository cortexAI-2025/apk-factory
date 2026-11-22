#!/bin/sh
# Fails loudly when the Flutter SDK is incomplete or cannot run for the current user.
# Run at image build time (as root and as the unprivileged builder user) and from CI.
# Overridable for tests: FLUTTER_HOME, FLUTTER_VERSION (expected), plus the bootstrap variables.
FLUTTER_HOME="${FLUTTER_HOME:-/opt/flutter}"
here="$(dirname "$0")"
[ -r "$here/flutter-bootstrap.sh" ] || here=/usr/local/lib/apk-factory
fail() { echo "FLUTTER HEALTH FAILED: $1" >&2; exit 1; }

[ -d "$FLUTTER_HOME" ]                  || fail "$FLUTTER_HOME does not exist (SDK not installed)"
[ -x "$FLUTTER_HOME/bin/flutter" ]      || fail "$FLUTTER_HOME/bin/flutter is missing or not executable"
[ -d "$FLUTTER_HOME/packages/flutter_tools" ] || fail "packages/flutter_tools is missing: the checkout is incomplete"
[ -r "$FLUTTER_HOME/bin/internal/engine.version" ] || fail "bin/internal/engine.version is missing"

. "$here/flutter-bootstrap.sh"

# The Dart SDK is downloaded into bin/cache on first run: it must be there, complete, and
# the stamp that says so must resolve (a dangling symlink here was the original failure).
dart_bin="$FLUTTER_HOME/bin/cache/dart-sdk/bin/dart"
[ -x "$dart_bin" ]                     || fail "Dart SDK missing: $dart_bin (flutter precache did not complete)"
[ -r "$FLUTTER_HOME/bin/cache/dart-sdk/version" ] || fail "Dart SDK is incomplete: bin/cache/dart-sdk/version is missing"
stamp="$FLUTTER_HOME/bin/cache/engine-dart-sdk.stamp"
{ [ -e "$stamp" ] && [ -r "$stamp" ]; } || fail "$stamp does not resolve (dangling symlink or missing). Stamps seed dir: ${FLUTTER_STAMP_DIR:-/tmp/flutter-stamps}"

dart_version="$("$dart_bin" --version 2>&1)" || fail "the bundled Dart SDK does not run: $dart_version"

flutter_out="$("$FLUTTER_HOME/bin/flutter" --version 2>&1)" || fail "flutter --version failed:
$flutter_out"
if [ -n "${FLUTTER_VERSION:-}" ]; then
  case "$flutter_out" in
    *"Flutter $FLUTTER_VERSION"*) ;;
    *) fail "expected Flutter $FLUTTER_VERSION, got: $(printf '%s' "$flutter_out" | head -n1)" ;;
  esac
fi
echo "flutter-health OK (uid=$(id -u)): $(printf '%s' "$flutter_out" | head -n1) | $dart_version"
