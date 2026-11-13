#!/usr/bin/env bash
# Shared helpers for the VM scripts. Sourced, never executed directly.
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mXX \033[0m %s\n' "$*" >&2; exit 1; }

# run <cmd...>: executes, or only prints the command with --dry-run
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '   [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# new_secret: 48 hex chars, from the kernel CSPRNG
new_secret() { openssl rand -hex 24; }

# set_env_value FILE KEY VALUE: replaces KEY=... in FILE (adds it if missing), keeps the file mode
set_env_value() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" "$file"; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k"="v; next} {print}' "$file" > "$tmp"
  else
    cat "$file" > "$tmp"; printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$file"; rm -f "$tmp"
}

# get_env_value FILE KEY: prints the value (empty when unset)
get_env_value() { grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- || true; }
