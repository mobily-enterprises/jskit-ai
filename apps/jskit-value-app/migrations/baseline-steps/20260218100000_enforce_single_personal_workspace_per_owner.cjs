exports.up = async function up(knex) {
  const duplicateOwners = await knex("workspaces")
    .select("owner_user_id")
    .min({ keep_id: "id" })
    .count({ total: "*" })
    .where({ is_personal: true })
    .groupBy("owner_user_id")
    .having(knex.raw("COUNT(*) > 1"));

  for (const row of duplicateOwners) {
    const ownerUserId = Number(row.owner_user_id);
    const keepId = Number(row.keep_id);
    if (!Number.isInteger(ownerUserId) || !Number.isInteger(keepId)) {
      continue;
    }

    await knex("workspaces")
      .where({ owner_user_id: ownerUserId, is_personal: true })
      .whereNot("id", keepId)
      .update({
        is_personal: false,
        updated_at: knex.raw("UTC_TIMESTAMP(3)")
      });
  }

  await knex.raw(`
    ALTER TABLE workspaces
    ADD COLUMN personal_owner_user_id BIGINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN is_personal = 1 THEN owner_user_id ELSE NULL END) STORED
  `);

  await knex.raw(`
    ALTER TABLE workspaces
    ADD UNIQUE INDEX uq_workspaces_personal_owner (personal_owner_user_id)
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE workspaces
    DROP INDEX uq_workspaces_personal_owner
  `);

  await knex.raw(`
    ALTER TABLE workspaces
    DROP COLUMN personal_owner_user_id
  `);
};
