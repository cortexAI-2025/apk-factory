#!/usr/bin/env bash
# Reproducible installation of APK Factory on a fresh Ubuntu 24.04 VM (Hetzner CPX32 class:
# 4 vCPU / 8 GB). Idempotent: safe to run again after a failure or an update.
#
#   sudo scripts/vps/install.sh [--dry-run] [--ref <git ref>]
#
# Does, in order: checks the host, installs Docker + Tailscale + ufw, locks the firewall to the
# tailnet, creates the data directories, writes .env with fresh secrets (only if missing),
# builds the images, starts the stack, publishes it through Tailscale Serve.
# It does NOT create the VM, does NOT open public ports and does NOT create any account.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091  # path is built from $here at runtime
. "$here/lib.sh"
REPO_URL="${APK_REPO_URL:-https://github.com/cortexAI-2025/apk-factory.git}"
REF="${APK_REF:-main}"
APP_DIR="${APP_DIR:-/opt/apk-factory}"
DATA_DIR="/srv/apk-factory"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --ref) REF="$2"; shift ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

# ── 1. host checks ───────────────────────────────────────────────────────────
log "1/8 host checks"
if [ "$DRY_RUN" != "1" ]; then
  [ "$(id -u)" = "0" ] || die "run as root (sudo)"
  . /etc/os-release
  if [ "${ID:-}" != "ubuntu" ] || [ "${VERSION_ID:-}" != "24.04" ]; then
    warn "tested on Ubuntu 24.04, found ${PRETTY_NAME:-unknown}"
  fi
  cpus="$(nproc)"; mem_gb="$(awk '/MemTotal/ {printf "%d", $2/1048576}' /proc/meminfo)"
  [ "$cpus" -ge 4 ] || die "need at least 4 vCPU (found $cpus)"
  [ "$mem_gb" -ge 7 ] || die "need at least 8 GB RAM (found ~${mem_gb} GB)"
else
  warn "dry-run: host checks skipped"
fi

# ── 2. packages ──────────────────────────────────────────────────────────────
log "2/8 packages: docker, tailscale, ufw"
run apt-get update -q
run apt-get install -y -q ca-certificates curl git openssl ufw jq age
if ! command -v docker >/dev/null 2>&1; then
  run install -m 0755 -d /etc/apt/keyrings
  run sh -c 'curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc'
  run sh -c 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list'
  run apt-get update -q
  run apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if ! command -v tailscale >/dev/null 2>&1; then
  # Official installer from Tailscale; pin the version here if you need reproducibility beyond that.
  run sh -c 'curl -fsSL https://tailscale.com/install.sh | sh'
fi

# ── 3. firewall: nothing public, SSH only as a fallback until Tailscale SSH is set up ──
log "3/8 firewall (ufw)"
run ufw default deny incoming
run ufw default allow outgoing
run ufw allow in on tailscale0
run ufw allow 41641/udp comment 'tailscale direct connections'
run ufw allow OpenSSH comment 'fallback admin access; remove once Tailscale SSH works'
run ufw --force enable

# ── 4. data directories ──────────────────────────────────────────────────────
log "4/8 data directories under $DATA_DIR"
run install -d -m 0755 "$DATA_DIR" "$DATA_DIR/maven-cache"
run install -d -m 1777 "$DATA_DIR/workspaces"
run install -d -m 0700 "$DATA_DIR/backups"

# ── 5. code at a pinned ref ──────────────────────────────────────────────────
log "5/8 code: $REPO_URL @ $REF"
if [ -d "$APP_DIR/.git" ]; then
  run git -C "$APP_DIR" fetch --quiet origin "$REF"
  run git -C "$APP_DIR" checkout --quiet "$REF"
  run git -C "$APP_DIR" pull --quiet --ff-only origin "$REF" || true
else
  run git clone --quiet --branch "$REF" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR" 2>/dev/null || { [ "$DRY_RUN" = "1" ] || die "cannot enter $APP_DIR"; }

# ── 6. configuration: secrets generated once, never overwritten ──────────────
log "6/8 configuration (.env)"
if [ ! -f .env ]; then
  run cp .env.vps.example .env
  if [ "$DRY_RUN" != "1" ]; then
    chmod 600 .env
    set_env_value .env POSTGRES_PASSWORD "$(new_secret)"
    set_env_value .env REDIS_PASSWORD "$(new_secret)"
    set_env_value .env JWT_SECRET "$(new_secret)"
    set_env_value .env WORKER_SECRET "$(new_secret)"
    set_env_value .env COMPOSE_PROJECT_NAME apk-factory
  fi
  warn "created .env with fresh secrets; set FRONTEND_URL and API_BASE_URL to your tailnet names"
fi
if [ "$DRY_RUN" != "1" ]; then
  # derive the public URLs from the tailnet name when they are still placeholders
  if grep -q '<vm>' .env && command -v tailscale >/dev/null && tailscale status >/dev/null 2>&1; then
    dns="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
    set_env_value .env FRONTEND_URL "https://${dns}"
    set_env_value .env API_BASE_URL "https://${dns}:8443"
    log "public URLs set from Tailscale: https://${dns}"
  fi
  grep -q '<vm>' .env && die "FRONTEND_URL / API_BASE_URL still contain placeholders: run 'tailscale up' first"
  [ -n "$(get_env_value .env ANTHROPIC_API_KEY)" ] || warn "ANTHROPIC_API_KEY empty: AutoFix uses rule-based fixes only"
fi

# ── 7. images and stack ──────────────────────────────────────────────────────
log "7/8 images and stack (first build takes several minutes)"
run docker compose --profile init build android-builder-init
run docker compose build backend worker frontend
run docker compose up -d postgres redis
run docker compose up -d --wait backend frontend worker apk-egress-proxy

# ── 8. private publication through Tailscale ────────────────────────────────
log "8/8 Tailscale Serve (tailnet only)"
run "$here/tailscale-serve.sh"

log "done. Next: create your account (registration is closed):"
echo "   printf '%s' 'YOUR-PASSWORD-12+' | docker compose exec -T backend npm run -s user:create -- you@example.com 'Your Name' --stdin"
echo "   Then open the FRONTEND_URL from the Galaxy A14 (Tailscale app connected)."
