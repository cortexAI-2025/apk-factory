#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# APK Factory — One-time setup script
#
# Run this ONCE before the first `docker-compose up`.
# Safe to re-run — all steps are idempotent.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; exit 1; }
step() { echo -e "\n${YELLOW}▶ $*${NC}"; }

echo "════════════════════════════════════════════════════════════"
echo "  APK Factory — Setup"
echo "════════════════════════════════════════════════════════════"

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
step "Checking prerequisites"
command -v docker  >/dev/null 2>&1 || fail "Docker is not installed"
command -v docker-compose >/dev/null 2>&1 || docker compose version >/dev/null 2>&1 || fail "docker-compose is not installed"
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# ── 2. Environment file ───────────────────────────────────────────────────────
step "Environment file"
if [ ! -f .env ]; then
    if [ ! -f .env.example ]; then
        cat > .env.example <<'EOF'
# Required
POSTGRES_PASSWORD=changeme_db
REDIS_PASSWORD=changeme_redis
JWT_SECRET=changeme_jwt_super_long_secret_here
WORKER_SECRET=changeme_worker_secret

# Optional — add your Anthropic API key for AI AutoFix
ANTHROPIC_API_KEY=

# URLs (adjust for production)
API_BASE_URL=http://localhost:4000
FRONTEND_URL=http://localhost:3000

# Build sandbox limits (increase if builds OOM)
BUILD_MEMORY=3g
BUILD_CPUS=2
BUILD_TIMEOUT_MS=1500000

# Network mode for build containers:
#   bridge  = internet access (default — needed for Maven dependency downloads)
#   none    = fully offline  (requires pre-seeded Maven cache via scripts/maven/seed-cache.sh)
BUILD_NETWORK_MODE=bridge
EOF
    fi
    cp .env.example .env
    warn ".env created from .env.example — please edit secrets before continuing"
    echo "  Edit .env now and re-run this script."
    exit 0
fi
ok ".env exists"

# ── 3. Workspace directory ────────────────────────────────────────────────────
step "Workspace directory"
WORKSPACE_DIR="/tmp/apk-factory/workspaces"
mkdir -p "${WORKSPACE_DIR}"
chmod 1777 "${WORKSPACE_DIR}"
ok "Workspace: ${WORKSPACE_DIR}"

# ── 4. Build the Android builder image ───────────────────────────────────────
step "Building android-builder image (this takes 5–10 min on first run)"
echo "  Downloads: Android SDK platforms, build-tools, 10 Gradle distributions"
COMPOSE_CMD="docker-compose"
command -v docker-compose >/dev/null 2>&1 || COMPOSE_CMD="docker compose"

${COMPOSE_CMD} --profile init build android-builder-init
ok "Image apk-factory/android-builder:latest ready"

# Verify the image works
echo "  Verifying image..."
docker run --rm apk-factory/android-builder:latest \
    /bin/bash -c "java -version 2>&1 | head -1 && echo 'SDK platforms:' && ls /opt/android-sdk/platforms/" \
    2>&1 | sed 's/^/    /'
ok "Android builder image verified"

# ── 5. Start infrastructure (postgres + redis only) ──────────────────────────
step "Starting infrastructure (postgres + redis)"
${COMPOSE_CMD} up -d postgres redis
echo "  Waiting for postgres to be healthy..."
for i in $(seq 1 30); do
    if ${COMPOSE_CMD} exec -T postgres pg_isready -U apk_user -d apk_factory >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
ok "PostgreSQL ready"

# ── 6. Run database migrations ────────────────────────────────────────────────
step "Running database migrations"
${COMPOSE_CMD} run --rm backend sh -c "npx prisma migrate deploy"
ok "Migrations applied"

# ── 7. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}Setup complete!${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  Start the full stack:"
echo "    docker-compose up -d"
echo ""
echo "  Frontend:  http://localhost:3000"
echo "  Backend:   http://localhost:4000"
echo "  API docs:  http://localhost:4000/api/v1/docs"
echo ""
echo "  Optional — seed Maven offline cache (faster builds, enables network=none):"
echo "    bash scripts/maven/seed-cache.sh"
echo ""
