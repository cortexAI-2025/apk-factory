#!/usr/bin/env bash
# Publishes the UI and the API on the tailnet ONLY, over HTTPS (certificates issued by Tailscale).
#   443  -> web UI  (127.0.0.1:3000)
#   8443 -> API     (127.0.0.1:4000)   Tailscale Serve allows 443, 8443 and 10000 only.
# Nothing is exposed on the public internet: `tailscale serve` is not `tailscale funnel`.
# Usage: scripts/vps/tailscale-serve.sh [--dry-run]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091  # path is built from $here at runtime
. "$here/lib.sh"
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
command -v tailscale >/dev/null || { [ "$DRY_RUN" = "1" ] || die "tailscale is not installed"; }

run tailscale serve --bg --https=443 http://127.0.0.1:3000
run tailscale serve --bg --https=8443 http://127.0.0.1:4000
if [ "$DRY_RUN" != "1" ]; then
  tailscale serve status
  # Funnel would expose these ports to the whole internet. Check that it is off:
  echo "Check that Funnel is OFF (must not be listed as enabled):"
  tailscale funnel status || true
fi
