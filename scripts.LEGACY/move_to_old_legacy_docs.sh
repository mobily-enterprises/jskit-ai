#!/usr/bin/env bash
set -euo pipefail

manifest_path="${1:-scripts/old_legacy_docs.paths}"
dest_root="old_legacy_docs"

if [[ ! -f "$manifest_path" ]]; then
  echo "Manifest not found: $manifest_path" >&2
  exit 1
fi

shopt -s globstar nullglob dotglob

moved_count=0
missing_count=0
skipped_count=0

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf "%s" "$value"
}

while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
  line="$(trim "$raw_line")"
  if [[ -z "$line" || "${line:0:1}" == "#" ]]; then
    continue
  fi

  line="${line#./}"

  matches=()
  while IFS= read -r match; do
    matches+=("$match")
  done < <(compgen -G "$line" || true)

  if [[ ${#matches[@]} -eq 0 && -e "$line" ]]; then
    matches+=("$line")
  fi

  if [[ ${#matches[@]} -eq 0 ]]; then
    echo "missing: $line"
    missing_count=$((missing_count + 1))
    continue
  fi

  for src in "${matches[@]}"; do
    if [[ ! -e "$src" ]]; then
      continue
    fi

    if [[ "$src" == "$dest_root"* ]]; then
      continue
    fi

    dest="$dest_root/$src"
    if [[ -e "$dest" ]]; then
      echo "skip-exists: $dest"
      skipped_count=$((skipped_count + 1))
      continue
    fi

    mkdir -p "$(dirname "$dest")"
    mv "$src" "$dest"
    echo "moved: $src -> $dest"
    moved_count=$((moved_count + 1))
  done
done < "$manifest_path"

echo "done: moved=$moved_count missing=$missing_count skipped=$skipped_count"
