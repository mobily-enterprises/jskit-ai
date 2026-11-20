// The invitation a membership was last accepted through, whose address the members list shows when it is not the
// member's account's. Null for an owner's membership, one an application added, and every membership made before it.
// The invitation's row goes with its workspace, and the reference is cleared then.
const MEMBERSHIPS_TABLE = "workspace_memberships";
const COLUMN_NAME = "accepted_invite_id";

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn(MEMBERSHIPS_TABLE, COLUMN_NAME))) {
    await knex.schema.alterTable(MEMBERSHIPS_TABLE, (table) => {
      table.bigInteger(COLUMN_NAME).unsigned().nullable().references("id").inTable("workspace_invites").onDelete("SET NULL");
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn(MEMBERSHIPS_TABLE, COLUMN_NAME)) {
    await knex.schema.alterTable(MEMBERSHIPS_TABLE, (table) => {
      table.dropForeign([COLUMN_NAME]);
      table.dropColumn(COLUMN_NAME);
    });
  }
};
