#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON_PATH="$APP_ROOT/package.json"
JSKIT_REGISTRY="${JSKIT_REGISTRY:-}"

if [[ ! -f "$PACKAGE_JSON_PATH" ]]; then
  echo "[jskit:update] package.json not found: $PACKAGE_JSON_PATH" >&2
  exit 1
fi

readarray -t runtime_packages < <(
  node -e '
    const fs = require("node:fs");
    const packageJson = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const dependencies = packageJson?.dependencies || {};
    const names = Object.keys(dependencies).filter((name) => name.startsWith("@jskit-ai/")).sort();
    for (const name of names) {
      process.stdout.write(`${name}\n`);
    }
  ' "$PACKAGE_JSON_PATH"
)

readarray -t dev_packages < <(
  node -e '
    const fs = require("node:fs");
    const packageJson = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const dependencies = packageJson?.devDependencies || {};
    const names = Object.keys(dependencies).filter((name) => name.startsWith("@jskit-ai/")).sort();
    for (const name of names) {
      process.stdout.write(`${name}\n`);
    }
  ' "$PACKAGE_JSON_PATH"
)

registry_args=()
if [[ -n "$JSKIT_REGISTRY" ]]; then
  registry_args+=(--registry "$JSKIT_REGISTRY")
fi

if (( ${#runtime_packages[@]} == 0 && ${#dev_packages[@]} == 0 )); then
  echo "[jskit:update] no @jskit-ai packages found in dependencies."
  exit 0
fi

resolve_major_range() {
  local package_name="$1"
  local latest_version
  if ! latest_version="$(npm view "${registry_args[@]}" "$package_name" version)"; then
    echo "[jskit:update] failed to resolve latest version for $package_name." >&2
    exit 1
  fi
  latest_version="$(printf "%s" "$latest_version" | tr -d '[:space:]')"

  if [[ ! "$latest_version" =~ ^([0-9]+)\.[0-9]+\.[0-9]+([.+-][0-9A-Za-z.-]+)?$ ]]; then
    echo "[jskit:update] invalid latest version for $package_name: $latest_version" >&2
    exit 1
  fi

  local major="${BASH_REMATCH[1]}"
  printf "%s.x" "$major"
}

runtime_specs=()
for package_name in "${runtime_packages[@]}"; do
  runtime_specs+=("${package_name}@$(resolve_major_range "$package_name")")
done

dev_specs=()
for package_name in "${dev_packages[@]}"; do
  dev_specs+=("${package_name}@$(resolve_major_range "$package_name")")
done

if (( ${#runtime_specs[@]} > 0 )); then
  echo "[jskit:update] updating runtime packages: ${runtime_specs[*]}"
  (
    cd "$APP_ROOT"
    npm install --save-exact "${registry_args[@]}" "${runtime_specs[@]}"
  )
fi

if (( ${#dev_specs[@]} > 0 )); then
  echo "[jskit:update] updating dev packages: ${dev_specs[*]}"
  (
    cd "$APP_ROOT"
    npm install --save-dev --save-exact "${registry_args[@]}" "${dev_specs[@]}"
  )
fi

echo "[jskit:update] done."
