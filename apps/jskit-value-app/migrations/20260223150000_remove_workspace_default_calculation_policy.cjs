const REMOVED_POLICY_KEYS = [
  "defaultMode",
  "defaultTiming",
  "defaultPaymentsPerYear",
  "defaultHistoryPageSize"
];

function parsePolicyJson(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "object") {
    return { ...value };
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...parsed };
    }
  } catch {
    return {};
  }

  return {};
}

function removeObsoleteKeys(policy) {
  const nextPolicy = { ...policy };
  let changed = false;

  for (const key of REMOVED_POLICY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(nextPolicy, key)) {
      delete nextPolicy[key];
      changed = true;
    }
  }

  return {
    policy: nextPolicy,
    changed
  };
}

exports.up = async function up(knex) {
  const hasWorkspaceSettingsTable = await knex.schema.hasTable("workspace_settings");
  if (!hasWorkspaceSettingsTable) {
    return;
  }

  const rows = await knex("workspace_settings").select("workspace_id", "policy_json");
  for (const row of rows) {
    const currentPolicy = parsePolicyJson(row.policy_json);
    const { policy, changed } = removeObsoleteKeys(currentPolicy);
    if (!changed) {
      continue;
    }

    await knex("workspace_settings")
      .where({ workspace_id: row.workspace_id })
      .update({
        policy_json: JSON.stringify(policy),
        updated_at: knex.raw("UTC_TIMESTAMP(3)")
      });
  }
};

exports.down = async function down() {
  // Destructive data migration: removed keys cannot be restored.
};
