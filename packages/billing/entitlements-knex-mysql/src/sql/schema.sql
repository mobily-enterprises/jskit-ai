-- MySQL schema for @jskit-ai/entitlements-knex-mysql
-- This schema intentionally covers only entitlement engine tables.

CREATE TABLE IF NOT EXISTS {{entitlementDefinitions}} (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(191) NOT NULL,
  name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  entitlement_type VARCHAR(64) NOT NULL,
  unit VARCHAR(64) NOT NULL,
  window_interval VARCHAR(32) NULL,
  window_anchor VARCHAR(32) NULL,
  aggregation_mode VARCHAR(32) NOT NULL DEFAULT 'sum',
  enforcement_mode VARCHAR(64) NOT NULL DEFAULT 'hard_deny',
  scope_type VARCHAR(64) NOT NULL DEFAULT 'billable_entity',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_entitlement_definitions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {{entitlementGrants}} (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject_type VARCHAR(64) NOT NULL DEFAULT 'billable_entity',
  subject_id BIGINT UNSIGNED NOT NULL,
  entitlement_definition_id BIGINT UNSIGNED NOT NULL,
  amount BIGINT NOT NULL,
  kind VARCHAR(64) NOT NULL,
  effective_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NULL,
  source_type VARCHAR(64) NOT NULL,
  source_id BIGINT UNSIGNED NULL,
  operation_key VARCHAR(191) NULL,
  provider VARCHAR(64) NULL,
  provider_event_id VARCHAR(191) NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_entitlement_grants_dedupe (dedupe_key),
  CONSTRAINT fk_entitlement_grants_definition
    FOREIGN KEY (entitlement_definition_id)
    REFERENCES {{entitlementDefinitions}} (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {{entitlementConsumptions}} (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject_type VARCHAR(64) NOT NULL DEFAULT 'billable_entity',
  subject_id BIGINT UNSIGNED NOT NULL,
  entitlement_definition_id BIGINT UNSIGNED NOT NULL,
  amount BIGINT UNSIGNED NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  reason_code VARCHAR(120) NOT NULL,
  operation_key VARCHAR(191) NULL,
  usage_event_key VARCHAR(191) NULL,
  provider_event_id VARCHAR(191) NULL,
  request_id VARCHAR(128) NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_entitlement_consumptions_dedupe (dedupe_key),
  CONSTRAINT fk_entitlement_consumptions_definition
    FOREIGN KEY (entitlement_definition_id)
    REFERENCES {{entitlementDefinitions}} (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {{entitlementBalances}} (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject_type VARCHAR(64) NOT NULL DEFAULT 'billable_entity',
  subject_id BIGINT UNSIGNED NOT NULL,
  entitlement_definition_id BIGINT UNSIGNED NOT NULL,
  window_start_at DATETIME(3) NOT NULL DEFAULT '1970-01-01 00:00:00.000',
  window_end_at DATETIME(3) NOT NULL DEFAULT '9999-12-31 23:59:59.999',
  granted_amount BIGINT NOT NULL DEFAULT 0,
  consumed_amount BIGINT NOT NULL DEFAULT 0,
  effective_amount BIGINT NOT NULL DEFAULT 0,
  hard_limit_amount BIGINT NULL,
  over_limit TINYINT(1) NOT NULL DEFAULT 0,
  lock_state VARCHAR(120) NULL,
  next_change_at DATETIME(3) NULL,
  last_recomputed_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_entitlement_balances_subject_window (subject_type, subject_id, entitlement_definition_id, window_start_at, window_end_at),
  CONSTRAINT fk_entitlement_balances_definition
    FOREIGN KEY (entitlement_definition_id)
    REFERENCES {{entitlementDefinitions}} (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
