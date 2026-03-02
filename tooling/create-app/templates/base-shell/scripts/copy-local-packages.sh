#!/usr/bin/env bash
set -euo pipefail

SRC_PACKAGES_ROOT="${1:-../jskit-ai/packages}"
SRC_FRAMEWORK_CORE="${2:-../jskit-ai/framework-core}"
DST_ROOT="${3:-node_modules/@jskit-ai}"

if [[ ! -d "$SRC_PACKAGES_ROOT" ]]; then
  echo "Source directory not found: $SRC_PACKAGES_ROOT" >&2
  exit 1
fi

if [[ ! -d "$SRC_FRAMEWORK_CORE" ]]; then
  echo "Source directory not found: $SRC_FRAMEWORK_CORE" >&2
  exit 1
fi

mkdir -p "$DST_ROOT"

if [[ -L "$DST_ROOT/jskit" ]]; then
  rm -f "$DST_ROOT/jskit"
  echo "Removed symlink: jskit"
fi

rm -rf "$DST_ROOT/framework-core"
cp -a "$SRC_FRAMEWORK_CORE" "$DST_ROOT/framework-core"
echo "Copied: framework-core"

for pkg_dir in "$SRC_PACKAGES_ROOT"/*; do
  [[ -d "$pkg_dir" ]] || continue
  pkg_name="$(basename "$pkg_dir")"
  rm -rf "$DST_ROOT/$pkg_name"
  cp -a "$pkg_dir" "$DST_ROOT/$pkg_name"
  echo "Copied: $pkg_name"
done
