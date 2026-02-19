# Backup and Restore Runbook

Use this runbook before production releases that include schema or data-impacting changes.

## 1. Create Backup Artifact

```bash
export DB_HOST=127.0.0.1
export DB_PORT=3306
export DB_USER=annuity_app
export DB_NAME=material-app
export BACKUP_FILE="backup_${DB_NAME}_$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

mysqldump \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --set-gtid-purged=OFF \
  -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p "$DB_NAME" \
  | gzip > "$BACKUP_FILE"
```

Generate checksum:

```bash
sha256sum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"
sha256sum -c "${BACKUP_FILE}.sha256"
```

## 2. Restore Drill to Temporary DB

Create temp DB:

```bash
export TEMP_DB_NAME="${DB_NAME}_restore_verify"
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p -e "CREATE DATABASE IF NOT EXISTS \`${TEMP_DB_NAME}\`;"
```

Restore:

```bash
gunzip -c "$BACKUP_FILE" \
  | mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p "$TEMP_DB_NAME"
```

## 3. Verification SQL Checklist

Run against temp DB (`$TEMP_DB_NAME`):

```sql
SELECT COUNT(*) AS has_user_profiles
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'user_profiles';

SELECT COUNT(*) AS has_workspace_invites
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'workspace_invites';

SELECT COUNT(*) AS has_console_invites
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'console_invites';

SELECT COUNT(*) AS has_security_audit_events
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'security_audit_events';

SELECT COUNT(*) AS user_profiles_count FROM user_profiles;
SELECT COUNT(*) AS workspaces_count FROM workspaces;
SELECT COUNT(*) AS workspace_memberships_count FROM workspace_memberships;
SELECT COUNT(*) AS workspace_invites_count FROM workspace_invites;
SELECT COUNT(*) AS console_invites_count FROM console_invites;
SELECT COUNT(*) AS security_audit_events_count FROM security_audit_events;

SELECT wi.id, wi.email, w.slug
FROM workspace_invites wi
JOIN workspaces w ON w.id = wi.workspace_id
ORDER BY wi.id DESC
LIMIT 10;

SELECT cse.id, cse.action, cse.outcome, up.email AS actor_email
FROM security_audit_events cse
LEFT JOIN user_profiles up ON up.id = cse.actor_user_id
ORDER BY cse.id DESC
LIMIT 10;

SELECT name, batch, migration_time
FROM knex_migrations
ORDER BY migration_time DESC, id DESC
LIMIT 20;
```

If all checks pass, mark restore verification complete in release checklist.

## 4. Rollback Notes

- Keep the backup artifact and checksum for the full rollback window.
- If release rollback is required:
  1. Stop writes to the application.
  2. Restore backup into the production DB (or promote a verified restore).
  3. Deploy previous known-good app artifact.
  4. Validate critical read/write paths and auth/session flows.
- Record rollback timestamp, operator, and exact backup artifact used.
