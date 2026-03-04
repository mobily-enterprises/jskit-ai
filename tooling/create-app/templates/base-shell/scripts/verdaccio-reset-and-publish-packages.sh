#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERDACCIO_CONFIG="${VERDACCIO_CONFIG:-$HOME/.config/verdaccio/config.yaml}"
VERDACCIO_LISTEN="${VERDACCIO_LISTEN:-127.0.0.1:4873}"
VERDACCIO_REGISTRY="${VERDACCIO_REGISTRY:-http://$VERDACCIO_LISTEN}"
VERDACCIO_REGISTRY="${VERDACCIO_REGISTRY%/}"
VERDACCIO_LOG_FILE="${VERDACCIO_LOG_FILE:-/tmp/verdaccio-jskit.log}"
VERDACCIO_PID_FILE="${VERDACCIO_PID_FILE:-/tmp/verdaccio-jskit.pid}"
PUBLISH_CONCURRENCY="${PUBLISH_CONCURRENCY:-10}"
JSKIT_REPO_ROOT="${JSKIT_REPO_ROOT:-$HOME/Development/current/jskit-ai}"
PACKAGES_DIR="${PACKAGES_DIR:-$JSKIT_REPO_ROOT/packages}"
TOOLING_DIR="${TOOLING_DIR:-$JSKIT_REPO_ROOT/tooling}"

resolve_storage_dir() {
  if [[ -n "${VERDACCIO_STORAGE_DIR:-}" ]]; then
    echo "$VERDACCIO_STORAGE_DIR"
    return
  fi

  if [[ -f "$VERDACCIO_CONFIG" ]]; then
    local configured_storage=""
    configured_storage="$(sed -nE 's/^[[:space:]]*storage:[[:space:]]*([^#]+).*$/\1/p' "$VERDACCIO_CONFIG" | head -n 1 | xargs || true)"
    if [[ -n "$configured_storage" ]]; then
      if [[ "$configured_storage" = /* ]]; then
        echo "$configured_storage"
      else
        echo "$(cd "$(dirname "$VERDACCIO_CONFIG")" && pwd)/$configured_storage"
      fi
      return
    fi
  fi

  echo "$HOME/.local/share/verdaccio/storage"
}

stop_verdaccio() {
  local listen_port
  listen_port="${VERDACCIO_LISTEN##*:}"

  if [[ -f "$VERDACCIO_PID_FILE" ]]; then
    local pid
    pid="$(cat "$VERDACCIO_PID_FILE" || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" || true
    fi
    rm -f "$VERDACCIO_PID_FILE"
  fi

  if command -v lsof >/dev/null 2>&1; then
    local listener_pids
    listener_pids="$(lsof -tiTCP:"$listen_port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$listener_pids" ]]; then
      for pid in $listener_pids; do
        if [[ "$pid" != "$$" ]]; then
          kill "$pid" >/dev/null 2>&1 || true
        fi
      done
    fi

    local attempts=0
    while lsof -tiTCP:"$listen_port" -sTCP:LISTEN >/dev/null 2>&1; do
      attempts=$((attempts + 1))
      if (( attempts > 20 )); then
        break
      fi
      sleep 0.25
    done

    listener_pids="$(lsof -tiTCP:"$listen_port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$listener_pids" ]]; then
      for pid in $listener_pids; do
        if [[ "$pid" != "$$" ]]; then
          kill -9 "$pid" >/dev/null 2>&1 || true
        fi
      done
    fi
  fi
}

start_verdaccio() {
  local cmd=(npx --yes verdaccio --listen "$VERDACCIO_LISTEN")
  if [[ -f "$VERDACCIO_CONFIG" ]]; then
    cmd+=(--config "$VERDACCIO_CONFIG")
  fi

  nohup "${cmd[@]}" >"$VERDACCIO_LOG_FILE" 2>&1 &

  local attempts=0
  until curl -fsS "$VERDACCIO_REGISTRY/-/ping" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if (( attempts > 60 )); then
      echo "Verdaccio did not become ready at $VERDACCIO_REGISTRY within 60s." >&2
      echo "See log: $VERDACCIO_LOG_FILE" >&2
      exit 1
    fi
    sleep 1
  done

  local listen_port
  listen_port="${VERDACCIO_LISTEN##*:}"
  local listener_pid
  listener_pid="$(lsof -tiTCP:"$listen_port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "$listener_pid" ]]; then
    echo "$listener_pid" >"$VERDACCIO_PID_FILE"
  fi
}

publish_packages() {
  if [[ ! -d "$PACKAGES_DIR" ]]; then
    echo "Packages directory not found: $PACKAGES_DIR" >&2
    echo "Set PACKAGES_DIR to your monorepo packages path." >&2
    exit 1
  fi

  local dirs=()
  if [[ -f "$TOOLING_DIR/config-eslint/package.json" ]]; then
    dirs+=("$TOOLING_DIR/config-eslint")
  fi
  if [[ -f "$TOOLING_DIR/jskit-catalog/package.json" ]]; then
    dirs+=("$TOOLING_DIR/jskit-catalog")
  fi
  if [[ -f "$TOOLING_DIR/jskit-cli/package.json" ]]; then
    dirs+=("$TOOLING_DIR/jskit-cli")
  fi
  while IFS= read -r dir; do
    dirs+=("$dir")
  done < <(find "$PACKAGES_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

  if (( ${#dirs[@]} == 0 )); then
    echo "No package directories found under $PACKAGES_DIR" >&2
    exit 1
  fi

  local npm_userconfig
  local registry_with_slash
  local verdaccio_auth_token
  npm_userconfig="$(mktemp)"
  registry_with_slash="${VERDACCIO_REGISTRY%/}/"
  verdaccio_auth_token="${VERDACCIO_AUTH_TOKEN:-dev-local-token}"
  printf "@jskit-ai:registry=%s\nregistry=%s\n//%s/:_authToken=%s\n" \
    "$registry_with_slash" \
    "$registry_with_slash" \
    "${VERDACCIO_LISTEN}" \
    "$verdaccio_auth_token" >"$npm_userconfig"

  if [[ ! "$PUBLISH_CONCURRENCY" =~ ^[0-9]+$ ]] || (( PUBLISH_CONCURRENCY < 1 )); then
    echo "PUBLISH_CONCURRENCY must be a positive integer (got: $PUBLISH_CONCURRENCY)." >&2
    exit 1
  fi

  echo "Publishing with concurrency=$PUBLISH_CONCURRENCY"

  publish_one_package() {
    local dir="$1"
    local npm_userconfig="$2"
    if [[ ! -f "$dir/package.json" ]]; then
      return 0
    fi

    local package_name
    local publish_dir
    package_name="$(cd "$dir" && node -p "require('./package.json').name || ''")"
    echo "Publishing $package_name from $dir"

    publish_dir="$(mktemp -d)"
    (
      cd "$dir"
      tar --exclude='./node_modules' -cf - .
    ) | (
      cd "$publish_dir"
      tar -xf -
    )
    node -e 'const fs=require("node:fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));delete j.private;fs.writeFileSync(p,`${JSON.stringify(j,null,2)}\n`);' "$publish_dir/package.json"
    (
      cd "$publish_dir"
      npm publish \
        --registry "$VERDACCIO_REGISTRY" \
        --access public \
        --workspaces=false \
        --userconfig "$npm_userconfig"
    )
    rm -rf "$publish_dir"
  }

  local running_jobs=0
  local publish_failed=0
  for dir in "${dirs[@]}"; do
    publish_one_package "$dir" "$npm_userconfig" &
    running_jobs=$((running_jobs + 1))

    if (( running_jobs >= PUBLISH_CONCURRENCY )); then
      if ! wait -n; then
        publish_failed=1
      fi
      running_jobs=$((running_jobs - 1))
    fi
  done

  while (( running_jobs > 0 )); do
    if ! wait -n; then
      publish_failed=1
    fi
    running_jobs=$((running_jobs - 1))
  done

  if (( publish_failed != 0 )); then
    echo "One or more package publishes failed." >&2
    exit 1
  fi

  rm -f "$npm_userconfig"
}

main() {
  local storage_dir
  storage_dir="$(resolve_storage_dir)"

  echo "Stopping Verdaccio..."
  stop_verdaccio

  echo "Clearing Verdaccio storage: $storage_dir"
  rm -rf "$storage_dir"
  mkdir -p "$storage_dir"

  echo "Starting Verdaccio at $VERDACCIO_REGISTRY..."
  start_verdaccio

  echo "Publishing packages from $PACKAGES_DIR..."
  publish_packages

  echo "Done. Verdaccio is running at $VERDACCIO_REGISTRY"
}

main "$@"
