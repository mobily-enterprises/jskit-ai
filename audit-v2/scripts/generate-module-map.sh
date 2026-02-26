#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/audit-v2/module-map.md"

{
  echo "# Module Map"
  echo
  echo "Generated (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## Apps"
  find "$ROOT/apps" -mindepth 1 -maxdepth 1 -type d | sort | sed "s#^$ROOT/#- #"
  echo
  echo "## App Server Modules"
  for app in "$ROOT"/apps/*; do
    [ -d "$app/server/modules" ] || continue
    find "$app/server/modules" -mindepth 1 -maxdepth 1 -type d | sort | sed "s#^$ROOT/#- #"
  done
  echo
  echo "## Packages"
  find "$ROOT/packages" -name package.json | sed 's#/package.json$##' | sort | sed "s#^$ROOT/#- #"
} > "$OUT"

echo "Wrote $OUT"
