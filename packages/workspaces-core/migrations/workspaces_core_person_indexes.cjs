// The indexes a person's workspaces are read through, as workspaces_core_indexes_by_user describes them:
// ix_workspace_memberships_user (workspace_memberships.user_id) and ix_workspaces_owner (workspaces.owner_user_id), on
// PostgreSQL and SQLite. MySQL and MariaDB index both columns through their foreign keys, so there it adds nothing.
//
// workspaces_core_indexes_by_user runs before workspaces_core_initial (Knex runs a directory's migrations in file name
// order), so on a new database it finds no tables and adds nothing; this one runs after workspaces_core_initial and
// adds them. On a database that had the tables when workspaces_core_indexes_by_user ran, the indexes exist already and
// this one leaves them as they are.
const INDEXES = Object.freeze([
  Object.freeze({ table: "workspace_memberships", name: "ix_workspace_memberships_user", column: "user_id" }),
  Object.freeze({ table: "workspaces", name: "ix_workspaces_owner", column: "owner_user_id" })
]);

function foreignKeysAreIndexed(knex) {
  return /mysql|maria/iu.test(String(knex.client.config.client));
}

exports.up = async function up(knex) {
  if (foreignKeysAreIndexed(knex)) return;
  for (const { table, name, column } of INDEXES) {
    await knex.raw("create index if not exists ?? on ?? (??)", [name, table, column]);
  }
};

exports.down = async function down(knex) {
  if (foreignKeysAreIndexed(knex)) return;
  for (const { name } of INDEXES) {
    await knex.raw("drop index if exists ??", [name]);
  }
};
