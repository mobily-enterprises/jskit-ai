// A person's workspaces are read by person: their memberships by workspace_memberships.user_id (the workspaces
// list, an application's "homes of this person") and the workspaces they own by workspaces.owner_user_id (their
// personal workspace). The memberships' unique (workspace_id, user_id) key serves a workspace's members, not a
// person's workspaces, so without these indexes each such read scans every membership or workspace.
//
// PostgreSQL and SQLite index no foreign key's columns by themselves, so there the migration adds both. InnoDB (MySQL
// and MariaDB) made an index for each foreign key when the tables were created, named after the key
// (workspace_memberships_user_id_foreign, workspaces_owner_user_id_foreign), which already serves these reads, so
// there it adds nothing.
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
