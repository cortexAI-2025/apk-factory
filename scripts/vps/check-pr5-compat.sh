#!/usr/bin/env bash
# Compatibility check between this branch and the PR #5 head that CI validated (df86638).
# Local only: runs no CI, pushes nothing, deploys nothing.
#   scripts/vps/check-pr5-compat.sh [base-ref]     (default base: df86638)
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2
base="${1:-df86638}"
fail=0
ok()   { printf '  \033[1;32mPASS\033[0m %s\n' "$*"; }
bad()  { printf '  \033[1;31mFAIL\033[0m %s\n' "$*"; fail=1; }

echo "1. files changed since the validated PR head ($base), working tree included"
git diff --stat "$base" | tail -1
echo "   files (tracked changes + new files):"; { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u | sed 's/^/     /'

echo "2. CI does not run docker compose (so compose changes cannot affect CI)"
if grep -q "docker compose\|docker-compose" .github/workflows/ci.yml; then
  bad "ci.yml now uses compose: its results are no longer those of $base"
else ok "ci.yml does not use compose"; fi

echo "3. CI-validated behaviour is unchanged for CI"
if ! git diff --quiet "$base" -- .github/workflows/ci.yml; then
  bad "ci.yml changed: re-validation required before any merge"
else ok "ci.yml unchanged"; fi
# registration stays open when the variable is unset, which is what the e2e helpers rely on
if grep -q "ALLOW_PUBLIC_REGISTRATION === undefined) return true" backend/src/auth/registration-policy.ts; then
  ok "registration open by default (unset variable), e2e helpers unaffected"
else bad "registration default changed"; fi

echo "4. unit tests and typechecks on this branch"
if (cd backend && npx tsc --noEmit -p . && npm run -s build >/dev/null 2>&1 && npm test >/tmp/compat-be.log 2>&1); then ok "backend: $(grep -E '^# pass' /tmp/compat-be.log)"; else bad "backend tests (see /tmp/compat-be.log)"; fi
if (cd worker && npx tsc --noEmit -p . && npm test >/tmp/compat-wk.log 2>&1); then ok "worker: $(grep -E '^# pass' /tmp/compat-wk.log)"; else bad "worker tests (see /tmp/compat-wk.log)"; fi
if (cd frontend && npx tsc --noEmit -p . >/tmp/compat-fe.log 2>&1); then ok "frontend typecheck"; else bad "frontend typecheck (see /tmp/compat-fe.log)"; fi

echo "5. VM scripts"
if shellcheck -x scripts/vps/*.sh >/tmp/compat-sh.log 2>&1; then ok "shellcheck clean"; else bad "shellcheck (see /tmp/compat-sh.log)"; fi

echo "6. compose renders with the VM profile and publishes nothing public"
if POSTGRES_PASSWORD=x REDIS_PASSWORD=x JWT_SECRET=x WORKER_SECRET=x FRONTEND_URL=https://a.ts.net API_BASE_URL=https://a.ts.net:8443 \
   docker compose config >/tmp/compat-compose.yml 2>/dev/null; then
  if awk '/published:/{p=1} /host_ip:/{h=1} /published:/{if(!h) bad=1} /^  [a-z]/{h=0} END{exit bad}' /tmp/compat-compose.yml; then
    ok "every published port is bound to a specific host IP"
  else bad "a published port has no host_ip (would listen on all interfaces)"; fi
else bad "docker compose config failed"; fi

echo
[ "$fail" = 0 ] && echo "RESULT: compatible (local checks)" || echo "RESULT: NOT compatible, see FAIL lines"
exit "$fail"
