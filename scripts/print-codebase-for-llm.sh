#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r -d '' file; do
  [ -f "$file" ] || continue
  printf '# File: %s\n' "$file"
  cat "$file"
  printf '\n\n'
done < <(
  rg --files -0 --hidden -g '!.git/**' | sort -z
)
