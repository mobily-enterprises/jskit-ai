#!/bin/bash
#
APP="${1:-}"
if [[ -z "$APP" ]]; then
  echo "usage: $0 <app-name>" >&2
  exit 1
fi

for p in $(dokku plugin:list | awk '/service plugin$/ {print $1}'); do
  if dokku "$p:help" 2>/dev/null | grep -q 'app-links'; then
    out="$(dokku "$p:app-links" "$APP" 2>/dev/null || true)"
    [[ -n "$out" ]] && echo -e "== $p ==\n$out\n"
  fi
done

