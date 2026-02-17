exports.up = async function up(knex) {
  const now = knex.raw("UTC_TIMESTAMP(3)");

  await knex("workspace_invites").where({ status: "pending" }).andWhere("expires_at", "<=", now).update({
    status: "expired",
    updated_at: now
  });

  const duplicateGroups = await knex("workspace_invites")
    .select("workspace_id", "email")
    .max({ keep_id: "id" })
    .count({ total: "*" })
    .where({ status: "pending" })
    .groupBy("workspace_id", "email")
    .having(knex.raw("COUNT(*) > 1"));

  for (const row of duplicateGroups) {
    const workspaceId = Number(row.workspace_id);
    const keepId = Number(row.keep_id);
    const email = String(row.email || "")
      .trim()
      .toLowerCase();
    if (!Number.isInteger(workspaceId) || workspaceId < 1 || !Number.isInteger(keepId) || keepId < 1 || !email) {
      continue;
    }

    await knex("workspace_invites")
      .where({
        workspace_id: workspaceId,
        email,
        status: "pending"
      })
      .whereNot("id", keepId)
      .update({
        status: "revoked",
        updated_at: now
      });
  }

  await knex.raw(`
    ALTER TABLE workspace_invites
    ADD COLUMN pending_email VARCHAR(320)
      GENERATED ALWAYS AS (CASE WHEN status = 'pending' THEN email ELSE NULL END) STORED
  `);

  await knex.raw(`
    ALTER TABLE workspace_invites
    ADD UNIQUE INDEX uq_workspace_invites_workspace_pending_email (workspace_id, pending_email)
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE workspace_invites
    DROP INDEX uq_workspace_invites_workspace_pending_email
  `);

  await knex.raw(`
    ALTER TABLE workspace_invites
    DROP COLUMN pending_email
  `);
};
