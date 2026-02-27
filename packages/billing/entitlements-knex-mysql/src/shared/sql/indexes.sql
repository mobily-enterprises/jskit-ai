-- Optional performance indexes for @jskit-ai/entitlements-knex-mysql

CREATE INDEX idx_entitlement_definitions_type_active
  ON {{entitlementDefinitions}} (entitlement_type, is_active);

CREATE INDEX idx_entitlement_grants_subject_def_effective
  ON {{entitlementGrants}} (subject_type, subject_id, entitlement_definition_id, effective_at);

CREATE INDEX idx_entitlement_grants_subject_expires
  ON {{entitlementGrants}} (subject_type, subject_id, expires_at);

CREATE INDEX idx_entitlement_grants_source
  ON {{entitlementGrants}} (source_type, source_id);

CREATE INDEX idx_entitlement_consumptions_subject_def_occurred
  ON {{entitlementConsumptions}} (subject_type, subject_id, entitlement_definition_id, occurred_at);

CREATE INDEX idx_entitlement_consumptions_usage_event
  ON {{entitlementConsumptions}} (usage_event_key);

CREATE INDEX idx_entitlement_balances_subject_def
  ON {{entitlementBalances}} (subject_type, subject_id, entitlement_definition_id);

CREATE INDEX idx_entitlement_balances_next_change
  ON {{entitlementBalances}} (next_change_at);
