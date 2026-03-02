#!/usr/bin/env bash
set -euo pipefail

DEFAULT_TARGET="${HOME}/Development/current/manual-app"

TARGET_DIR="${1:-$DEFAULT_TARGET}"
APP_NAME="${2:-$(basename "$TARGET_DIR")}"
INSTALL_DEPS="${INSTALL_DEPS:-1}"

if [[ "${TARGET_DIR}" == "/" || -z "${TARGET_DIR}" ]]; then
  echo "Refusing to operate on unsafe target: ${TARGET_DIR}" >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}"

if [[ -d "${TARGET_DIR}/.git" ]]; then
  find "${TARGET_DIR}" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +
else
  rm -rf "${TARGET_DIR}"
  mkdir -p "${TARGET_DIR}"
fi

(
  cd "${TARGET_DIR}"
  npx @jskit-ai/create-app "${APP_NAME}" --target . --force

  if [[ "${INSTALL_DEPS}" == "1" ]]; then
    rm -f package-lock.json
    rm -rf node_modules
    npm install
  fi
)

echo "Scaffold reset complete: ${TARGET_DIR}"
