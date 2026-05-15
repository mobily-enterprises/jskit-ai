#!/usr/bin/env bash
set -euo pipefail

# Development-only postinstall hook.
# Normal installs no-op. Set JSKIT_DEVLINKS to opt into local JSKIT package
# links, for example:
#   JSKIT_DEVLINKS=/path/to/jskit-ai npm install
#   JSKIT_DEVLINKS=1 JSKIT_AI_ROOT=/path/to/jskit-ai npm install

SCRIPT_NAME="devel-link-local-packages-postinstall"

log() {
  printf '[%s] %s\n' "$SCRIPT_NAME" "$*" >&2
}

fail() {
  printf '[%s] ERROR: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

devlinks_value="${JSKIT_DEVLINKS-}"
case "$devlinks_value" in
  "" | "0" | "false" | "False" | "FALSE" | "no" | "No" | "NO" | "off" | "Off" | "OFF")
    log "JSKIT_DEVLINKS is not set; skipping local JSKIT package links."
    exit 0
    ;;
esac

repo_root=""
case "$devlinks_value" in
  "1" | "true" | "True" | "TRUE" | "yes" | "Yes" | "YES" | "on" | "On" | "ON" | "auto" | "Auto" | "AUTO")
    repo_root="${JSKIT_AI_ROOT-}"
    ;;
  *)
    repo_root="$devlinks_value"
    ;;
esac

if [ -z "$repo_root" ]; then
  fail "JSKIT_DEVLINKS is enabled, but no repo root was provided. Set JSKIT_DEVLINKS=/path/to/jskit-ai or JSKIT_AI_ROOT=/path/to/jskit-ai."
fi

if ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "JSKIT_DEVLINKS repo root is not a git work tree: $repo_root"
fi

repo_root="$(cd "$repo_root" && pwd -P)"
log "Linking local JSKIT packages from $repo_root."
npx --no-install jskit app link-local-packages --repo-root "$repo_root"
