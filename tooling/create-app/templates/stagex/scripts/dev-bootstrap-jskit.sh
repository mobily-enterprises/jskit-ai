#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOTSTRAP_MODE_RAW="${JSKIT_DEV_BOOTSTRAP:-auto}"
BOOTSTRAP_MODE="$(echo "$BOOTSTRAP_MODE_RAW" | tr '[:upper:]' '[:lower:]')"

is_valid_jskit_repo_root() {
  local candidate_root="$1"
  [[ -d "$candidate_root/packages" && -d "$candidate_root/packages/kernel" && -d "$candidate_root/tooling" ]]
}

find_jskit_repo_root() {
  local current_dir="$1"
  while true; do
    if is_valid_jskit_repo_root "$current_dir"; then
      echo "$current_dir"
      return 0
    fi
    if [[ "$current_dir" == "/" ]]; then
      return 1
    fi
    current_dir="$(dirname "$current_dir")"
  done
}

resolve_local_repo_root() {
  if [[ -n "${JSKIT_REPO_ROOT:-}" ]]; then
    echo "$JSKIT_REPO_ROOT"
    return 0
  fi

  find_jskit_repo_root "$APP_ROOT" || true
}

is_dokku_environment() {
  [[ -n "${DOKKU_APP_NAME:-}" || -n "${DOKKU_APP_TYPE:-}" ]]
}

resolve_bootstrap_mode() {
  local normalized_mode="$1"
  if [[ "$normalized_mode" != "auto" ]]; then
    echo "$normalized_mode"
    return 0
  fi

  if is_dokku_environment; then
    echo "on"
    return 0
  fi

  echo "off"
}

BOOTSTRAP_MODE="$(resolve_bootstrap_mode "$BOOTSTRAP_MODE")"
LOCAL_REPO_ROOT="$(resolve_local_repo_root)"

if [[ "$BOOTSTRAP_MODE" == "0" || "$BOOTSTRAP_MODE" == "false" || "$BOOTSTRAP_MODE" == "off" ]]; then
  echo "[dev-bootstrap] skipped (JSKIT_DEV_BOOTSTRAP disabled)."
  exit 0
fi

if is_valid_jskit_repo_root "$LOCAL_REPO_ROOT"; then
  echo "[dev-bootstrap] using local JSKIT repo: $LOCAL_REPO_ROOT"
  JSKIT_REPO_ROOT="$LOCAL_REPO_ROOT" bash "$APP_ROOT/scripts/verdaccio-reset-and-publish-packages.sh"
  exit 0
fi

if [[ "$BOOTSTRAP_MODE" != "1" && "$BOOTSTRAP_MODE" != "true" && "$BOOTSTRAP_MODE" != "on" ]]; then
  echo "[dev-bootstrap] skipped (no local JSKIT repo at $LOCAL_REPO_ROOT)."
  echo "[dev-bootstrap] set JSKIT_DEV_BOOTSTRAP=1 and JSKIT_GITHUB_TARBALL_URL to force remote bootstrap."
  exit 0
fi

JSKIT_GITHUB_TARBALL_URL="${JSKIT_GITHUB_TARBALL_URL:-}"
if [[ -z "$JSKIT_GITHUB_TARBALL_URL" ]]; then
  echo "[dev-bootstrap] failed: local JSKIT repo not found at $LOCAL_REPO_ROOT and JSKIT_GITHUB_TARBALL_URL is not set." >&2
  echo "[dev-bootstrap] set JSKIT_REPO_ROOT to a local checkout or set JSKIT_GITHUB_TARBALL_URL to an accessible tarball URL." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
TARBALL_PATH="$TMP_DIR/jskit-ai.tar.gz"
EXTRACT_DIR="$TMP_DIR/extracted"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "[dev-bootstrap] downloading $JSKIT_GITHUB_TARBALL_URL"
curl -fsSL "$JSKIT_GITHUB_TARBALL_URL" -o "$TARBALL_PATH"

mkdir -p "$EXTRACT_DIR"
tar -xzf "$TARBALL_PATH" -C "$EXTRACT_DIR"

JSKIT_REPO_ROOT="$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)"
if [[ -z "${JSKIT_REPO_ROOT:-}" ]]; then
  echo "[dev-bootstrap] failed: extracted archive is empty." >&2
  exit 1
fi

if [[ ! -d "$JSKIT_REPO_ROOT/packages" || ! -d "$JSKIT_REPO_ROOT/packages/kernel" || ! -d "$JSKIT_REPO_ROOT/tooling" ]]; then
  echo "[dev-bootstrap] failed: extracted archive does not look like jskit-ai monorepo." >&2
  echo "[dev-bootstrap] extracted root: $JSKIT_REPO_ROOT" >&2
  exit 1
fi

echo "[dev-bootstrap] publishing packages from extracted repo: $JSKIT_REPO_ROOT"
JSKIT_REPO_ROOT="$JSKIT_REPO_ROOT" bash "$APP_ROOT/scripts/verdaccio-reset-and-publish-packages.sh"
