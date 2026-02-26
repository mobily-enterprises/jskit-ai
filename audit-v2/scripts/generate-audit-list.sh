#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/audit-v2/audit-list.md"

mapfile -t MODULES < <(
  {
    for app in "$ROOT"/apps/*; do
      [ -d "$app/server/modules" ] || continue
      find "$app/server/modules" -mindepth 1 -maxdepth 1 -type d
    done
    find "$ROOT/packages" -name package.json | sed 's#/package.json$##'
  } | sort -u
)

{
  echo "# Audit List (Module-First, Monorepo-Wide)"
  echo
  echo "Issue ID format for each entry: \`NNN-ISSUE-###\`"
  echo "- NNN = 3-digit audit entry number"
  echo "- ### = per-entry issue sequence"
  echo

  i=1
  for abs in "${MODULES[@]}"; do
    rel="${abs#$ROOT/}"
    key="$(echo "$rel" | tr '/.' '-' | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
    nnn="$(printf '%03d' "$i")"
    report="$ROOT/audit-v2/reports/${key}.report.md"

    echo "## ${nnn}) Module: ${rel}"
    echo "Report file:"
    echo "- ${report}"
    echo
    echo "Required scope:"
    echo "- ${abs}"

    if [ -f "$abs/README.md" ]; then
      echo
      echo "Required docs:"
      echo "- ${abs}/README.md"
    fi

    echo
    i=$((i + 1))
  done
} > "$OUT"

echo "Wrote $OUT"
