const path = require("path");

const BASELINE_STEP_FILES = Object.freeze([
  "20260215120000_create_user_profiles.cjs",
  "20260215120100_create_calculation_logs.cjs",
  "20260216110000_create_user_settings.cjs",
  "20260216230000_add_user_avatar_columns.cjs",
  "20260217090000_add_password_sign_in_enabled_to_user_settings.cjs",
  "20260217113000_add_password_setup_required_to_user_settings.cjs",
  "20260217120000_create_workspaces.cjs",
  "20260217120100_create_workspace_memberships.cjs",
  "20260217120200_create_workspace_settings.cjs",
  "20260217120300_create_workspace_invites.cjs",
  "20260217120400_add_last_active_workspace_id_to_user_settings.cjs",
  "20260217120500_add_workspace_id_to_calculation_logs.cjs",
  "20260217120600_backfill_personal_workspaces_and_workspace_ids.cjs",
  "20260217120700_add_workspace_color.cjs",
  "20260217130000_add_avatar_url_to_workspaces.cjs",
  "20260218100000_enforce_single_personal_workspace_per_owner.cjs",
  "20260218110000_enforce_single_pending_workspace_invite_per_email.cjs",
  "20260219120000_create_workspace_projects.cjs",
  "20260220090000_create_console_memberships.cjs",
  "20260220090100_create_console_invites.cjs",
  "20260220090200_create_console_root_identity.cjs",
  "20260220100000_create_console_browser_errors.cjs",
  "20260220100100_create_console_server_errors.cjs",
  "20260220110000_create_security_audit_events.cjs",
  "20260220130000_create_ai_transcripts.cjs",
  "20260220140000_create_console_settings.cjs",
  "20260220150000_add_title_to_ai_conversations.cjs",
  "20260221090000_create_billing_phase1_tables.cjs",
  "20260221110000_add_billing_phase2_1_tables.cjs",
  "20260221130000_add_billing_phase2_3_payment_links_and_invoice_scope.cjs",
  "20260221150000_add_billing_phase2_4_billable_entity_scopes.cjs",
  "20260221170000_add_billing_usage_event_dedupe.cjs",
  "20260221190000_drop_billing_plan_family_version.cjs",
  "20260222100000_simplify_billing_plan_core_price_mapping.cjs",
  "20260222120000_add_billing_plan_change_lifecycle.cjs",
  "20260222143000_drop_obsolete_billing_tables.cjs",
  "20260222150000_drop_billing_plan_prices.cjs",
  "20260222154000_unify_billing_event_tables.cjs",
  "20260222170000_unify_billing_plan_state_and_add_purchase_ledger.cjs",
  "20260222183000_create_billing_products_catalog.cjs",
  "20260222190000_create_chat_user_settings_and_blocks.cjs",
  "20260222190100_create_chat_threads_and_participants.cjs",
  "20260222190200_create_chat_messages_and_attachments.cjs",
  "20260222190300_create_chat_message_idempotency_tombstones.cjs",
  "20260222190400_create_chat_reactions_and_indexes.cjs",
  "20260222201000_allow_free_plans_and_indefinite_assignments.cjs",
  "20260222213000_ensure_free_billing_plan.cjs",
  "20260222230000_create_billing_entitlements_engine_tables.cjs",
  "20260222232000_backfill_billing_entitlements_engine.cjs",
  "20260223090000_enforce_unique_workspace_room_thread.cjs",
  "20260223100000_add_deg2rad_columns_to_calculation_logs.cjs",
  "20260223113000_rename_annuity_entitlement_codes_to_deg2rad.cjs",
  "20260223150000_remove_workspace_default_calculation_policy.cjs",
  "20260225100000_create_social_federation_tables.cjs"
]);

function defaultLoadMigration(stepFile) {
  return require(path.resolve(__dirname, "..", "migration-baseline-steps", stepFile));
}

function createBaselineRunner({
  stepFiles = BASELINE_STEP_FILES,
  loadMigration = defaultLoadMigration
} = {}) {
  if (!Array.isArray(stepFiles) || stepFiles.length < 1) {
    throw new Error("Baseline migration requires at least one step file.");
  }

  async function run(direction, knex) {
    for (const stepFile of stepFiles) {
      const migration = loadMigration(stepFile);
      if (!migration || typeof migration !== "object") {
        throw new Error(`Baseline step "${stepFile}" did not export a migration module.`);
      }

      const migrationStep = migration[direction];
      if (typeof migrationStep !== "function") {
        throw new Error(`Baseline step "${stepFile}" is missing ${direction}().`);
      }

      await migrationStep(knex);
    }
  }

  return Object.freeze({
    async runUp(knex) {
      await run("up", knex);
    }
  });
}

exports.up = async function up(knex) {
  const runner = createBaselineRunner();
  await runner.runUp(knex);
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Migration 20260224000000_baseline_schema is irreversible.");
};

exports.__testables = Object.freeze({
  BASELINE_STEP_FILES,
  createBaselineRunner
});
