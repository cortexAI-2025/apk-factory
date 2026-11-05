#!/usr/bin/env bash
# Creates the internal build network and starts the allow-list egress proxy.
# Idempotent. Build containers (BUILD_NETWORK_MODE=restricted) join only the
# internal network, so squid is their single way out, limited to the hosts in
# docker/egress-proxy/allowed-domains.txt.
set -euo pipefail
cd "$(dirname "$0")/.."
NET="${BUILD_NETWORK_NAME:-apk-build-net}"
NAME="${EGRESS_PROXY_NAME:-apk-egress-proxy}"
IMAGE="${EGRESS_PROXY_IMAGE:-ubuntu/squid:latest}"

docker network inspect "$NET" >/dev/null 2>&1 || docker network create --internal "$NET" >/dev/null
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped --network "$NET" \
  --security-opt no-new-privileges:true --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add CHOWN --cap-add DAC_OVERRIDE \
  -v "$PWD/docker/egress-proxy/squid.conf:/etc/squid/squid.conf:ro" \
  -v "$PWD/docker/egress-proxy/allowed-domains.txt:/etc/squid/allowed-domains.txt:ro" \
  "$IMAGE" >/dev/null
# second leg: the default bridge gives the proxy (and only the proxy) internet access
docker network connect bridge "$NAME"
for i in $(seq 1 30); do
  docker logs "$NAME" 2>&1 | grep -qi "Accepting HTTP Socket connections\|listening port" && break
  sleep 1
done
echo "egress proxy '$NAME' ready on internal network '$NET'"
