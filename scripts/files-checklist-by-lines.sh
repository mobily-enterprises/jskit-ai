#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r -d '' file; do
  lines="$(wc -l < "$file")"
  printf '%s\t%s\n' "$lines" "$file"
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
    -g '!**/*.md' \
    -g '!**/*.todo' \
    -g '!**/*.pyc'
) \
| sort -nr -k1,1 -k2,2 \
| awk -F '\t' '
  {
    total += $1
    printf("- [ ] %s (%s lines)\n", $2, $1)
  }
  END {
    printf("- [ ] TOTAL (%s lines)\n", total)
  }
'
