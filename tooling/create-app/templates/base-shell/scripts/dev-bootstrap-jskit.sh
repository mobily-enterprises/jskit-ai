#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${JSKIT_DEV_BOOTSTRAP:-0}" != "1" ]]; then
  echo "[dev-bootstrap] skipped (set JSKIT_DEV_BOOTSTRAP=1 to enable)."
  exit 0
fi

JSKIT_GITHUB_TARBALL_URL="${JSKIT_GITHUB_TARBALL_URL:-https://codeload.github.com/jskit-ai/jskit-ai/tar.gz/refs/heads/main}"
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

if [[ ! -d "$JSKIT_REPO_ROOT/packages" || ! -d "$JSKIT_REPO_ROOT/framework-core" || ! -d "$JSKIT_REPO_ROOT/tooling" ]]; then
  echo "[dev-bootstrap] failed: extracted archive does not look like jskit-ai monorepo." >&2
  echo "[dev-bootstrap] extracted root: $JSKIT_REPO_ROOT" >&2
  exit 1
fi

echo "[dev-bootstrap] publishing packages from extracted repo: $JSKIT_REPO_ROOT"
JSKIT_REPO_ROOT="$JSKIT_REPO_ROOT" bash "$APP_ROOT/scripts/verdaccio-reset-and-publish-packages.sh"
