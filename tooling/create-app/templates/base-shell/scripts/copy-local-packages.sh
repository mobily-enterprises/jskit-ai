#!/usr/bin/env bash
set -euo pipefail

SRC_PACKAGES_ROOT="${1:-../../jskit-ai/packages}"
SRC_FRAMEWORK_CORE="${2:-../../jskit-ai/framework-core}"
DST_ROOT="${3:-node_modules/@jskit-ai}"
SRC_JSKIT_ROOT="${4:-../../jskit-ai}"

if [[ ! -d "$SRC_PACKAGES_ROOT" ]]; then
  echo "Source directory not found: $SRC_PACKAGES_ROOT" >&2
  exit 1
fi

if [[ ! -d "$SRC_FRAMEWORK_CORE" ]]; then
  echo "Source directory not found: $SRC_FRAMEWORK_CORE" >&2
  exit 1
fi

if [[ ! -d "$SRC_JSKIT_ROOT" ]]; then
  echo "Source directory not found: $SRC_JSKIT_ROOT" >&2
  exit 1
fi

mkdir -p "$DST_ROOT"

rm -rf "$DST_ROOT/jskit"
mkdir -p "$DST_ROOT/jskit"
cp -a "$SRC_JSKIT_ROOT/package.json" "$DST_ROOT/jskit/package.json"
for dir_name in tooling packages framework-core; do
  if [[ -d "$SRC_JSKIT_ROOT/$dir_name" ]]; then
    cp -a "$SRC_JSKIT_ROOT/$dir_name" "$DST_ROOT/jskit/$dir_name"
  fi
done
echo "Copied: jskit (tooling, packages, framework-core)"

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
