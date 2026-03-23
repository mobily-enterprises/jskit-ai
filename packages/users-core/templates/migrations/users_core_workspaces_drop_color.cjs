const WORKSPACES_TABLE = "workspaces";
const WORKSPACE_SETTINGS_TABLE = "workspace_settings";
const LEGACY_COLOR_COLUMN = "color";
const SETTINGS_LIGHT_PRIMARY_COLOR_COLUMN = "light_primary_color";
const DEFAULT_WORKSPACE_COLOR = "#1867C0";

async function hasTable(knex, tableName) {
  return knex.schema.hasTable(tableName);
}

async function hasColumn(knex, tableName, columnName) {
  return knex.schema.hasColumn(tableName, columnName);
}

function normalizeHexColor(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : "";
}

exports.up = async function up(knex) {
  const hasWorkspaces = await hasTable(knex, WORKSPACES_TABLE);
  if (!hasWorkspaces) {
    return;
  }

  const hasLegacyColor = await hasColumn(knex, WORKSPACES_TABLE, LEGACY_COLOR_COLUMN);
  if (!hasLegacyColor) {
    return;
  }

  await knex.schema.alterTable(WORKSPACES_TABLE, (table) => {
    table.dropColumn(LEGACY_COLOR_COLUMN);
  });
};

exports.down = async function down(knex) {
  const hasWorkspaces = await hasTable(knex, WORKSPACES_TABLE);
  if (!hasWorkspaces) {
    return;
  }

  const hasLegacyColor = await hasColumn(knex, WORKSPACES_TABLE, LEGACY_COLOR_COLUMN);
  if (!hasLegacyColor) {
    await knex.schema.alterTable(WORKSPACES_TABLE, (table) => {
      table.string(LEGACY_COLOR_COLUMN, 7).notNullable().defaultTo(DEFAULT_WORKSPACE_COLOR);
    });
  }

  const hasWorkspaceSettings = await hasTable(knex, WORKSPACE_SETTINGS_TABLE);
  if (!hasWorkspaceSettings) {
    return;
  }

  const hasLightPrimaryColor = await hasColumn(
    knex,
    WORKSPACE_SETTINGS_TABLE,
    SETTINGS_LIGHT_PRIMARY_COLOR_COLUMN
  );
  if (!hasLightPrimaryColor) {
    return;
  }

  const workspaceSettingsRows = await knex(WORKSPACE_SETTINGS_TABLE).select(
    "workspace_id",
    SETTINGS_LIGHT_PRIMARY_COLOR_COLUMN
  );

  for (const row of workspaceSettingsRows) {
    const workspaceId = Number(row?.workspace_id || 0);
    if (!Number.isInteger(workspaceId) || workspaceId < 1) {
      continue;
    }

    const restoredColor = normalizeHexColor(row?.[SETTINGS_LIGHT_PRIMARY_COLOR_COLUMN]);
    if (!restoredColor) {
      continue;
    }

    await knex(WORKSPACES_TABLE)
      .where({ id: workspaceId })
      .update({
        color: restoredColor
      });
  }
};
