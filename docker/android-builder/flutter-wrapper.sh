#!/bin/sh
# Installed as /usr/local/bin/flutter and /usr/local/bin/dart (ahead of the SDK in PATH).
# Seeds the /tmp-backed stamps, then runs the real SDK binary. This makes the SDK usable
# without the container entrypoint, which is how toolchain checks invoke it.
FLUTTER_HOME="${FLUTTER_HOME:-/opt/flutter}"
tool="$(basename "$0")"
here="$(dirname "$0")"
[ -r "$here/flutter-bootstrap.sh" ] || here=/usr/local/lib/apk-factory
. "$here/flutter-bootstrap.sh"
case "$tool" in
  dart) real="$FLUTTER_HOME/bin/dart" ;;
  *)    real="$FLUTTER_HOME/bin/flutter" ;;
esac
[ -x "$real" ] || { echo "flutter-wrapper: $real is missing: the Flutter SDK is not installed" >&2; exit 127; }
exec "$real" "$@"
