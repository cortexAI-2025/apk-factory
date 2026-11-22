#!/bin/sh
# Fails loudly when the Flutter SDK is incomplete or cannot run for the current user.
# Run at image build time (as root and as the unprivileged builder user) and from CI.
# Overridable for tests: FLUTTER_HOME, FLUTTER_VERSION (expected), plus the bootstrap variables.
FLUTTER_HOME="${FLUTTER_HOME:-/opt/flutter}"
FLUTTER_STAMP_DIR="${FLUTTER_STAMP_DIR:-/tmp/flutter-stamps}"
FLUTTER_STAMP_SEED="${FLUTTER_STAMP_SEED:-/opt/flutter-stamps}"
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

# Flutter rebuilds its tool (pub upgrade, which WRITES under the SDK) at every start when
# bin/internal/shared.sh finds any of: no snapshot, no/mismatching flutter_tools.stamp
# (expected "<git HEAD>:$FLUTTER_TOOL_ARGS"), or pubspec.yaml newer than pubspec.lock.
# On the read-only sandbox that write fails (READ_ONLY_FILESYSTEM). Prove none can happen.
tools="$FLUTTER_HOME/packages/flutter_tools"
[ -f "$FLUTTER_HOME/bin/cache/flutter_tools.snapshot" ] || fail "bin/cache/flutter_tools.snapshot is missing: Flutter would rebuild its tool at start"
tstamp="$FLUTTER_STAMP_DIR/flutter_tools.stamp"
[ -s "$tstamp" ] || fail "flutter_tools.stamp is missing or empty in the stamp seed ($FLUTTER_STAMP_SEED): Flutter would rebuild its tool at start and fail on a read-only root"
want="$(git -C "$FLUTTER_HOME" rev-parse HEAD 2>/dev/null):${FLUTTER_TOOL_ARGS:-}"
[ "$(cat "$tstamp")" = "$want" ] || fail "flutter_tools.stamp does not match the SDK revision (have '$(cat "$tstamp")', want '$want')"
if [ -f "$tools/pubspec.lock" ] && [ "$tools/pubspec.yaml" -nt "$tools/pubspec.lock" ]; then
  fail "packages/flutter_tools/pubspec.yaml is newer than pubspec.lock: Flutter would run pub upgrade at start"
fi
[ -f "$tools/pubspec.lock" ] || fail "packages/flutter_tools/pubspec.lock is missing: Flutter would run pub upgrade at start"

# Cache.updateAll -> PubDependencies.isUpToDate: every package listed in flutter_tools'
# package_config.json must exist and be readable by THIS user, or Flutter runs `pub get` on its
# own tool at the first create/pub get/build and fails on the read-only root.
tool_cfg="$tools/.dart_tool/package_config.json"
[ -r "$tool_cfg" ] || fail "$tool_cfg is missing or unreadable: Flutter would run pub get on its own tool"
if command -v node >/dev/null 2>&1; then
  missing="$(node -e '
    const fs=require("fs"),path=require("path"),url=require("url");
    const cfg=process.argv[1], base=path.dirname(cfg);
    const miss=[];
    for (const p of JSON.parse(fs.readFileSync(cfg,"utf8")).packages) {
      const root=p.rootUri.startsWith("file:")?url.fileURLToPath(p.rootUri):path.resolve(base,decodeURIComponent(p.rootUri));
      try { fs.accessSync(path.join(root,"pubspec.yaml"),fs.constants.R_OK); } catch { miss.push(p.name+" -> "+root); }
    }
    console.log(miss.slice(0,5).join("\n"));' "$tool_cfg")" || fail "cannot read $tool_cfg"
  [ -z "$missing" ] || fail "flutter_tools packages not readable by uid $(id -u) (Flutter would run pub get on its own tool and fail on a read-only root):
$missing"
fi

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
