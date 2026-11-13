#!/usr/bin/env bash
# Encrypted PostgreSQL backup (+ optional uploads), with local retention and optional off-site copy.
#
#   BACKUP_AGE_RECIPIENT   age public key (age1...). REQUIRED: backups are never written in clear.
#   BACKUP_DIR             default /srv/apk-factory/backups
#   BACKUP_KEEP_DAYS       default 14
#   BACKUP_UPLOADS         default false. Uploads contain project sources and APKs, which the privacy
#                          policy deletes after 24 h. Keeping them in backups would contradict it,
#                          so they are excluded unless you explicitly accept that trade-off.
#   BACKUP_REMOTE          optional rsync target, e.g. u123@u123.your-storagebox.de:apk-factory/
#   BACKUP_REMOTE_PORT     default 23 (Hetzner Storage Box SSH port)
#
# Usage: scripts/vps/backup.sh            (run from the repository root, daily via cron/systemd timer)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091  # path is built from $here at runtime
. "$here/lib.sh"
cd "$here/../.."

: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT to an age public key; refusing to write unencrypted backups}"
BACKUP_DIR="${BACKUP_DIR:-/srv/apk-factory/backups}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
PROJECT="${COMPOSE_PROJECT_NAME:-apk-factory}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"; chmod 0700 "$BACKUP_DIR"

# 1. database: custom format (restorable selectively), streamed straight into age
db_out="$BACKUP_DIR/db-$stamp.dump.age"
docker compose exec -T postgres pg_dump -U apk_user -d apk_factory --format=custom --no-owner \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "$db_out"
chmod 0600 "$db_out"
log "database -> $db_out ($(du -h "$db_out" | cut -f1))"

# 2. uploads (opt-in only)
if [ "${BACKUP_UPLOADS:-false}" = "true" ]; then
  up_out="$BACKUP_DIR/uploads-$stamp.tar.age"
  docker run --rm -v "${PROJECT}_uploads_data:/data:ro" alpine:3.20 tar -C /data -cf - . \
    | age -r "$BACKUP_AGE_RECIPIENT" -o "$up_out"
  chmod 0600 "$up_out"
  warn "uploads included: sources and APKs are now kept for ${KEEP} days, beyond the 24 h policy"
  log "uploads -> $up_out"
fi

# 3. local retention
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.age' -o -name 'uploads-*.age' \) -mtime "+$KEEP" -print -delete \
  | sed 's/^/   pruned /' || true

# 4. off-site copy (already encrypted; the remote never sees clear data)
if [ -n "${BACKUP_REMOTE:-}" ]; then
  command -v rsync >/dev/null || die "rsync is required for BACKUP_REMOTE"
  rsync -a --chmod=F600 -e "ssh -p ${BACKUP_REMOTE_PORT:-23} -o BatchMode=yes" \
    --include='*.age' --exclude='*' "$BACKUP_DIR/" "$BACKUP_REMOTE"
  log "off-site copy sent to $BACKUP_REMOTE"
else
  warn "BACKUP_REMOTE not set: backups exist only on this VM (not a real backup against VM loss)"
fi
