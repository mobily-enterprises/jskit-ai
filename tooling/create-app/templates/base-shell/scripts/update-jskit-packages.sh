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

runtime_specs=()
for package_name in "${runtime_packages[@]}"; do
  runtime_specs+=("${package_name}@latest")
done

dev_specs=()
for package_name in "${dev_packages[@]}"; do
  dev_specs+=("${package_name}@latest")
done

registry_args=()
if [[ -n "$JSKIT_REGISTRY" ]]; then
  registry_args+=(--registry "$JSKIT_REGISTRY")
fi

if (( ${#runtime_specs[@]} == 0 && ${#dev_specs[@]} == 0 )); then
  echo "[jskit:update] no @jskit-ai packages found in dependencies."
  exit 0
fi

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
