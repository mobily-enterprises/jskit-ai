// users-core and workspaces-core migrate after rewarded-core, and rewarded_watch_sessions is created
// after rewarded_unlock_receipts, so these keys are added in this later phase, once every parent exists.
const KEYS = [
  { tableName: "rewarded_provider_configs", columnName: "workspace_id", parentTable: "workspaces",
    name: "fk_rewarded_provider_configs_workspace", onUpdate: "RESTRICT", onDelete: "CASCADE" },
  { tableName: "rewarded_rules", columnName: "workspace_id", parentTable: "workspaces",
    name: "fk_rewarded_rules_workspace", onUpdate: "RESTRICT", onDelete: "CASCADE" },
  { tableName: "rewarded_unlock_receipts", columnName: "user_id", parentTable: "users",
    name: "fk_rewarded_unlock_receipts_user", onUpdate: "RESTRICT", onDelete: "CASCADE" },
  { tableName: "rewarded_unlock_receipts", columnName: "watch_session_id", parentTable: "rewarded_watch_sessions",
    name: "fk_rewarded_unlock_receipts_watch_session", onUpdate: "RESTRICT", onDelete: "SET NULL" },
  { tableName: "rewarded_unlock_receipts", columnName: "workspace_id", parentTable: "workspaces",
    name: "fk_rewarded_unlock_receipts_workspace", onUpdate: "RESTRICT", onDelete: "CASCADE" },
  { tableName: "rewarded_watch_sessions", columnName: "user_id", parentTable: "users",
    name: "fk_rewarded_watch_sessions_user", onUpdate: "RESTRICT", onDelete: "CASCADE" },
  { tableName: "rewarded_watch_sessions", columnName: "workspace_id", parentTable: "workspaces",
    name: "fk_rewarded_watch_sessions_workspace", onUpdate: "RESTRICT", onDelete: "CASCADE" }
];

exports.up = async function up(knex) {
  const { addMissingForeignKey } = await import("@jskit-ai/database-runtime/server/foreignKeyMigrations");
  for (const key of KEYS) {
    await addMissingForeignKey(knex, key);
  }
};

exports.down = async function down(knex) {
  const { dropForeignKeyIfPresent } = await import("@jskit-ai/database-runtime/server/foreignKeyMigrations");
  for (const key of KEYS) {
    await dropForeignKeyIfPresent(knex, key);
  }
};
