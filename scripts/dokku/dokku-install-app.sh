#!/usr/bin/env bash
set -Eeuo pipefail

CENTRAL_DB="${CENTRAL_DB:-central_db}"
CENTRAL_REDIS="${CENTRAL_REDIS:-central_redis}"

usage() {
  cat <<'EOF'
Usage:
  dokku-install-app.sh <app-name> <letsencrypt-email>

Creates/recreates a Dokku app, links shared MariaDB/Redis services,
creates a dedicated database for the app, and sets config vars.

Arguments:
  <app-name>           Dokku app name to create
  <letsencrypt-email>  Email address to use for the app's Let's Encrypt cert

Options:
  -h, --help    Show this help

Environment overrides:
  CENTRAL_DB     Shared MariaDB service name (default: central_db)
  CENTRAL_REDIS  Shared Redis service name   (default: central_redis)

Examples:
  dokku-install-app.sh beepollen ops@example.com
  CENTRAL_DB=mydb CENTRAL_REDIS=myredis dokku-install-app.sh my-app ops@example.com
EOF
}

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

APP="$1"
LETSENCRYPT_EMAIL="$2"

# Reasonable Dokku app-name sanity check
if [[ ! "$APP" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  die "Invalid app name: '$APP' (use lowercase letters, numbers, and hyphens only)"
fi

if [[ ! "$LETSENCRYPT_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  die "Invalid Let's Encrypt email: '$LETSENCRYPT_EMAIL'"
fi

require_cmd dokku

DB="${APP}_db"

log "Reading DSN for MariaDB service '$CENTRAL_DB'"
SERVICE_DSN="$(dokku mariadb:info "$CENTRAL_DB" --dsn)"
BASE_DSN="${SERVICE_DSN%/*}"

DB_USER="${SERVICE_DSN#mysql://}"
DB_USER="${DB_USER%%:*}"

log "Destroying app '$APP' if it already exists"
dokku apps:destroy "$APP" --force || true

log "Dropping database '$DB' if it already exists"
dokku mariadb:enter "$CENTRAL_DB" sh -lc \
  "MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mariadb -uroot -e 'DROP DATABASE IF EXISTS \`$DB\`;'"

log "Creating app '$APP'"
dokku apps:create "$APP"

log "Linking MariaDB service '$CENTRAL_DB'"
dokku mariadb:link "$CENTRAL_DB" "$APP" --no-restart

log "Linking Redis service '$CENTRAL_REDIS'"
dokku redis:link "$CENTRAL_REDIS" "$APP" --no-restart

log "Creating database '$DB' and granting privileges to '$DB_USER'"
dokku mariadb:enter "$CENTRAL_DB" sh -lc \
  "MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mariadb -uroot -e 'CREATE DATABASE IF NOT EXISTS \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON \`$DB\`.* TO '\''$DB_USER'\''@'\''%'\''; FLUSH PRIVILEGES;'"

log "Setting Dokku config for '$APP'"
dokku config:set "$APP" \
  DATABASE_URL="${BASE_DSN}/${DB}" \
  REDIS_NAMESPACE="${APP}::prod"


dokku git:set "$APP" deploy-branch main

log "Configuring Let's Encrypt for '$APP'"
dokku letsencrypt:set "$APP" email "$LETSENCRYPT_EMAIL"
dokku letsencrypt:enable "$APP"

log "Done. App '$APP' is ready."
