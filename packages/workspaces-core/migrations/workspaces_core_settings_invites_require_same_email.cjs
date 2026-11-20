// Whether only an invitation's own address may accept the workspace's invitations, where the application lets any
// account accept them (config.workspaceInvitations.anyAccount). Every existing workspace starts without the rule.
const WORKSPACE_SETTINGS_TABLE = "workspace_settings";
const COLUMN_NAME = "invites_require_same_email";

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn(WORKSPACE_SETTINGS_TABLE, COLUMN_NAME))) {
    await knex.schema.alterTable(WORKSPACE_SETTINGS_TABLE, (table) => {
      table.boolean(COLUMN_NAME).notNullable().defaultTo(false);
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn(WORKSPACE_SETTINGS_TABLE, COLUMN_NAME)) {
    await knex.schema.alterTable(WORKSPACE_SETTINGS_TABLE, (table) => {
      table.dropColumn(COLUMN_NAME);
    });
  }
};
