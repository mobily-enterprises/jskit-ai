#!/usr/bin/env bash
set -euo pipefail

total=0

while IFS= read -r -d '' file; do
  lines="$(wc -l < "$file")"
  total=$((total + lines))
  printf -- '- [ ] %s (%s lines)\n' "$file" "$lines"
done < <(
  rg --files -0 \
    -g '!**/node_modules/**' \
    -g '!**/LEGACY/**' \
    -g '!docs/**' \
    -g '!**/test/**' \
    -g '!**/tests/**' \
    -g '!**/__tests__/**' \
    -g '!**/*.test.*' \
    -g '!**/*.spec.*' \
    -g '!**/__pycache__/**' \
    -g '!**/*.pyc' \
  | sort -z
)

printf -- '- [ ] TOTAL (%s lines)\n' "$total"
