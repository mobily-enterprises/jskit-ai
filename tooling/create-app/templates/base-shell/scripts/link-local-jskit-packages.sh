#!/usr/bin/env bash
# Re-link installed @jskit-ai packages in node_modules to a local jskit-ai monorepo checkout.
# Run this AFTER `npm install` when you want live local development without publishing packages.
#
# Usage:
#   npm run link:local:jskit
#   JSKIT_REPO_ROOT=/abs/path/to/jskit-ai npm run link:local:jskit
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCOPE_DIR="$APP_ROOT/node_modules/@jskit-ai"

is_valid_jskit_repo_root() {
  local candidate_root="$1"
  [[ -d "$candidate_root/packages" && -d "$candidate_root/packages/kernel" && -d "$candidate_root/tooling" ]]
}

to_absolute_dir() {
  local candidate_dir="$1"
  (cd "$candidate_dir" && pwd)
}

resolve_local_repo_root() {
  if [[ -n "${JSKIT_REPO_ROOT:-}" ]]; then
    if [[ -d "$JSKIT_REPO_ROOT" ]]; then
      to_absolute_dir "$JSKIT_REPO_ROOT"
      return 0
    fi
    echo "$JSKIT_REPO_ROOT"
    return 0
  fi

  local current_dir
  current_dir="$(dirname "$APP_ROOT")"
  while true; do
    local candidate_root="$current_dir/jskit-ai"
    if is_valid_jskit_repo_root "$candidate_root"; then
      to_absolute_dir "$candidate_root"
      return 0
    fi
    if [[ "$current_dir" == "/" ]]; then
      return 1
    fi
    current_dir="$(dirname "$current_dir")"
  done
}

JSKIT_REPO_ROOT="$(resolve_local_repo_root || true)"

if [[ ! -d "$SCOPE_DIR" ]]; then
  echo "[link-local] @jskit-ai scope not found at $SCOPE_DIR (run npm install first)." >&2
  exit 1
fi

if [[ -z "$JSKIT_REPO_ROOT" ]]; then
  echo "[link-local] no JSKIT repository found." >&2
  echo "[link-local] set JSKIT_REPO_ROOT to a local jskit-ai checkout path." >&2
  exit 1
fi

if ! is_valid_jskit_repo_root "$JSKIT_REPO_ROOT"; then
  echo "[link-local] JSKIT_REPO_ROOT is not a valid jskit-ai checkout: $JSKIT_REPO_ROOT" >&2
  exit 1
fi

resolve_source_dir() {
  local package_dir_name="$1"
  case "$package_dir_name" in
    config-eslint|create-app|jskit-cli|jskit-catalog)
      echo "$JSKIT_REPO_ROOT/tooling/$package_dir_name"
      ;;
    *)
      echo "$JSKIT_REPO_ROOT/packages/$package_dir_name"
      ;;
  esac
}

linked_count=0
skipped_count=0

for installed_path in "$SCOPE_DIR"/*; do
  if [[ ! -e "$installed_path" && ! -L "$installed_path" ]]; then
    continue
  fi

  package_dir_name="$(basename "$installed_path")"
  source_dir="$(resolve_source_dir "$package_dir_name")"

  if [[ ! -f "$source_dir/package.json" ]]; then
    echo "[link-local] skip @jskit-ai/$package_dir_name (no local source at $source_dir)"
    skipped_count=$((skipped_count + 1))
    continue
  fi

  rm -rf "$installed_path"
  ln -s "$source_dir" "$installed_path"
  echo "[link-local] linked @jskit-ai/$package_dir_name -> $source_dir"
  linked_count=$((linked_count + 1))
done

echo "[link-local] done. linked=$linked_count skipped=$skipped_count"
