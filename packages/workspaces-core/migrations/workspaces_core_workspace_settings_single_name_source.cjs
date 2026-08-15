const WORKSPACE_SETTINGS_TABLE = "workspace_settings";
const WORKSPACES_TABLE = "workspaces";
const LEGACY_NAME_COLUMN = "name";
const LEGACY_AVATAR_COLUMN = "avatar_url";

async function hasTable(knex, tableName) {
  return knex.schema.hasTable(tableName);
}

async function hasColumn(knex, tableName, columnName) {
  return knex.schema.hasColumn(tableName, columnName);
}

exports.up = async function up(knex) {
  const hasWorkspaceSettings = await hasTable(knex, WORKSPACE_SETTINGS_TABLE);
  if (!hasWorkspaceSettings) {
    return;
  }

  const hasLegacyName = await hasColumn(knex, WORKSPACE_SETTINGS_TABLE, LEGACY_NAME_COLUMN);
  const hasLegacyAvatarUrl = await hasColumn(knex, WORKSPACE_SETTINGS_TABLE, LEGACY_AVATAR_COLUMN);
  if (!hasLegacyName && !hasLegacyAvatarUrl) {
    return;
  }

  await knex.schema.alterTable(WORKSPACE_SETTINGS_TABLE, (table) => {
    if (hasLegacyName) {
      table.dropColumn(LEGACY_NAME_COLUMN);
    }
    if (hasLegacyAvatarUrl) {
      table.dropColumn(LEGACY_AVATAR_COLUMN);
    }
  });
};

exports.down = async function down(knex) {
  const hasWorkspaceSettings = await hasTable(knex, WORKSPACE_SETTINGS_TABLE);
  if (!hasWorkspaceSettings) {
    return;
  }

  const hasLegacyName = await hasColumn(knex, WORKSPACE_SETTINGS_TABLE, LEGACY_NAME_COLUMN);
  const hasLegacyAvatarUrl = await hasColumn(knex, WORKSPACE_SETTINGS_TABLE, LEGACY_AVATAR_COLUMN);
  if (!hasLegacyName || !hasLegacyAvatarUrl) {
    await knex.schema.alterTable(WORKSPACE_SETTINGS_TABLE, (table) => {
      if (!hasLegacyName) {
        table.string(LEGACY_NAME_COLUMN, 160).notNullable().defaultTo("Workspace");
      }
      if (!hasLegacyAvatarUrl) {
        table.string(LEGACY_AVATAR_COLUMN, 512).notNullable().defaultTo("");
      }
    });
  }

  const hasWorkspaces = await hasTable(knex, WORKSPACES_TABLE);
  if (!hasWorkspaces) {
    return;
  }

  const workspaceRows = await knex(WORKSPACES_TABLE).select("id", "name", "avatar_url");
  for (const workspaceRow of workspaceRows) {
    const normalizedName = String(workspaceRow?.name || "").trim() || "Workspace";
    const normalizedAvatarUrl = String(workspaceRow?.avatar_url || "").trim();
    await knex(WORKSPACE_SETTINGS_TABLE)
      .where({ workspace_id: workspaceRow.id })
      .update({
        name: normalizedName,
        avatar_url: normalizedAvatarUrl
      });
  }
};
