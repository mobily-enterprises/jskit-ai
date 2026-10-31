// workspaces-core's migrations run after assistant-runtime's, and an application may create
// workspaces itself, so the assistant tables get their workspaces keys in this later phase, when
// that table exists; an application without workspaces gets none.
// A database migrated before this file may already have them from the table migrations.
const WORKSPACE_KEYS = [
  { tableName: "assistant_config", columnName: "workspace_id", parentTable: "workspaces", onDelete: "CASCADE" },
  { tableName: "assistant_conversations", columnName: "workspace_id", parentTable: "workspaces", onDelete: "CASCADE" },
  { tableName: "assistant_messages", columnName: "workspace_id", parentTable: "workspaces", onDelete: "CASCADE" }
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("workspaces"))) {
    return;
  }
  const { addMissingForeignKey } = await import("@jskit-ai/database-runtime/server/foreignKeyMigrations");
  for (const key of WORKSPACE_KEYS) {
    await addMissingForeignKey(knex, key);
  }
};

exports.down = async function down(knex) {
  const { dropForeignKeyIfPresent } = await import("@jskit-ai/database-runtime/server/foreignKeyMigrations");
  for (const key of WORKSPACE_KEYS) {
    await dropForeignKeyIfPresent(knex, key);
  }
};
