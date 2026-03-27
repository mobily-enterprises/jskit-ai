#!/usr/bin/env bash
# Link all local @jskit-ai packages from a jskit-ai monorepo checkout into node_modules.
# Run this AFTER `npm install` when you want live local development without publishing packages.
#
# Usage:
#   npm run link:local:jskit
#   JSKIT_REPO_ROOT=/abs/path/to/jskit-ai npm run link:local:jskit
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCOPE_DIR="$APP_ROOT/node_modules/@jskit-ai"

is_valid_jskit_repo_root() {
  local candidate_root="$1"
  [[ -d "$candidate_root/packages" && -d "$candidate_root/packages/kernel" && -d "$candidate_root/tooling" ]]
}

to_absolute_dir() {
  local candidate_dir="$1"
  (cd "$candidate_dir" && pwd)
}

resolve_local_repo_root() {
  if [[ -n "${JSKIT_REPO_ROOT:-}" ]]; then
    if [[ -d "$JSKIT_REPO_ROOT" ]]; then
      to_absolute_dir "$JSKIT_REPO_ROOT"
      return 0
    fi
    echo "$JSKIT_REPO_ROOT"
    return 0
  fi

  local current_dir
  current_dir="$(dirname "$APP_ROOT")"
  while true; do
    local candidate_root="$current_dir/jskit-ai"
    if is_valid_jskit_repo_root "$candidate_root"; then
      to_absolute_dir "$candidate_root"
      return 0
    fi
    if [[ "$current_dir" == "/" ]]; then
      return 1
    fi
    current_dir="$(dirname "$current_dir")"
  done
}

JSKIT_REPO_ROOT="$(resolve_local_repo_root || true)"

if [[ ! -d "$SCOPE_DIR" ]]; then
  echo "[link-local] @jskit-ai scope not found at $SCOPE_DIR (run npm install first)." >&2
  exit 1
fi

if [[ -z "$JSKIT_REPO_ROOT" ]]; then
  echo "[link-local] no JSKIT repository found." >&2
  echo "[link-local] set JSKIT_REPO_ROOT to a local jskit-ai checkout path." >&2
  exit 1
fi

if ! is_valid_jskit_repo_root "$JSKIT_REPO_ROOT"; then
  echo "[link-local] JSKIT_REPO_ROOT is not a valid jskit-ai checkout: $JSKIT_REPO_ROOT" >&2
  exit 1
fi

discover_local_package_map() {
  node - "$JSKIT_REPO_ROOT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = process.argv[2];
const parentDirectories = [
  path.join(repoRoot, "packages"),
  path.join(repoRoot, "tooling")
];
const packageMap = new Map();

for (const parentDirectory of parentDirectories) {
  if (!fs.existsSync(parentDirectory) || !fs.statSync(parentDirectory).isDirectory()) {
    continue;
  }

  for (const entry of fs.readdirSync(parentDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const packageRoot = path.join(parentDirectory, entry.name);
    const packageJsonPath = path.join(packageRoot, "package.json");
    const descriptorPath = path.join(packageRoot, "package.descriptor.mjs");
    if (!fs.existsSync(packageJsonPath) || !fs.existsSync(descriptorPath)) {
      continue;
    }

    let packageJson = {};
    try {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    } catch {
      continue;
    }

    const packageId = String(packageJson?.name || "").trim();
    if (!packageId.startsWith("@jskit-ai/")) {
      continue;
    }
    const packageDirName = packageId.slice("@jskit-ai/".length);
    if (!packageDirName || packageDirName.includes("/")) {
      continue;
    }

    if (!packageMap.has(packageDirName)) {
      packageMap.set(packageDirName, packageRoot);
    }
  }
}

for (const [packageDirName, packageRoot] of packageMap.entries()) {
  process.stdout.write(`${packageDirName}\t${packageRoot}\n`);
}
NODE
}

linked_count=0

mkdir -p "$SCOPE_DIR"
while IFS=$'\t' read -r package_dir_name source_dir; do
  if [[ -z "$package_dir_name" || -z "$source_dir" ]]; then
    continue
  fi

  target_path="$SCOPE_DIR/$package_dir_name"
  rm -rf "$target_path"
  ln -s "$source_dir" "$target_path"
  echo "[link-local] linked @jskit-ai/$package_dir_name -> $source_dir"
  linked_count=$((linked_count + 1))
done < <(discover_local_package_map)

echo "[link-local] done. linked=$linked_count"
