import { db } from "../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../lib/primitives/dateUtils.js";
import { isMysqlDuplicateEntryError } from "../../lib/primitives/mysqlErrors.js";
import {
  BILLING_CHECKOUT_SESSION_STATUS,
  BILLING_DEFAULT_PROVIDER,
  BILLING_IDEMPOTENCY_STATUS,
  BILLING_SUBSCRIPTION_STATUS,
  NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET,
  TERMINAL_SUBSCRIPTION_STATUS_SET
} from "./constants.js";
import { safeParseJson } from "./canonicalJson.js";

function parseJsonValue(value, fallback = null) {
  const parsed = safeParseJson(value, fallback);
  if (parsed == null) {
    return fallback;
  }
  return parsed;
}

function normalizeProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || BILLING_DEFAULT_PROVIDER;
}

function resolvePatchPropertyName(columnName) {
  const normalizedColumn = String(columnName || "").trim();
  if (!normalizedColumn) {
    return "";
  }

  if (!normalizedColumn.includes("_")) {
    return normalizedColumn;
  }

  return normalizedColumn.replace(/_([a-z])/g, (_fullMatch, letter) => letter.toUpperCase());
}

function toNullableIsoString(value) {
  if (!value) {
    return null;
  }

  return toIsoString(value);
}

function normalizeDateInput(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function toNullableString(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value || "").trim();
  return normalized || null;
}

const BILLABLE_ENTITY_TYPES = new Set(["workspace", "user", "organization", "external"]);

function normalizeBillableEntityType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return BILLABLE_ENTITY_TYPES.has(normalized) ? normalized : "workspace";
}

function mapPlanCorePriceFromPlanRow(row) {
  const providerPriceId = String(row?.checkout_provider_price_id || "").trim();
  if (!providerPriceId) {
    return null;
  }

  return {
    provider: normalizeProvider(row.checkout_provider),
    providerPriceId,
    providerProductId: row.checkout_provider_product_id == null ? null : String(row.checkout_provider_product_id),
    interval: String(row.checkout_interval || "month"),
    intervalCount: Number(row.checkout_interval_count || 1),
    currency: String(row.checkout_currency || "").toUpperCase(),
    unitAmountMinor: Number(row.checkout_unit_amount_minor || 0)
  };
}

function mapBillableEntityRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    entityType: normalizeBillableEntityType(row.entity_type),
    entityRef: row.entity_ref == null ? null : String(row.entity_ref),
    workspaceId: row.workspace_id == null ? null : Number(row.workspace_id),
    ownerUserId: row.owner_user_id == null ? null : Number(row.owner_user_id),
    status: String(row.status || "active"),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapPlanRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    description: row.description == null ? null : String(row.description),
    appliesTo: String(row.applies_to || "workspace"),
    corePrice: mapPlanCorePriceFromPlanRow(row),
    isActive: Boolean(row.is_active),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapProductPriceFromRow(row) {
  const providerPriceId = String(row?.provider_price_id || "").trim();
  if (!providerPriceId) {
    return null;
  }

  return {
    provider: normalizeProvider(row.provider),
    providerPriceId,
    providerProductId: row.provider_product_id == null ? null : String(row.provider_product_id),
    interval: row.price_interval == null ? null : String(row.price_interval),
    intervalCount: row.price_interval_count == null ? null : Number(row.price_interval_count),
    currency: String(row.currency || "").toUpperCase(),
    unitAmountMinor: Number(row.unit_amount_minor || 0)
  };
}

function mapProductRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    description: row.description == null ? null : String(row.description),
    productKind: String(row.product_kind || "one_off"),
    price: mapProductPriceFromRow(row),
    isActive: Boolean(row.is_active),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapEntitlementRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    planId: Number(row.plan_id),
    code: String(row.code || ""),
    schemaVersion: String(row.schema_version || ""),
    valueJson: parseJsonValue(row.value_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapCustomerRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    billableEntityId: Number(row.billable_entity_id),
    provider: normalizeProvider(row.provider),
    providerCustomerId: String(row.provider_customer_id || ""),
    email: row.email == null ? null : String(row.email),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapSubscriptionRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    billableEntityId: Number(row.billable_entity_id),
    planId: Number(row.plan_id),
    billingCustomerId: row.billing_customer_id == null ? null : Number(row.billing_customer_id),
    provider: normalizeProvider(row.provider),
    providerCustomerId: row.provider_customer_id == null ? null : String(row.provider_customer_id),
    providerSubscriptionId: String(row.provider_subscription_id || ""),
    status: String(row.status || BILLING_SUBSCRIPTION_STATUS.INCOMPLETE),
    providerSubscriptionCreatedAt: toIsoString(row.provider_subscription_created_at),
    currentPeriodEnd: toNullableIsoString(row.current_period_end),
    trialEnd: toNullableIsoString(row.trial_end),
    canceledAt: toNullableIsoString(row.canceled_at),
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    endedAt: toNullableIsoString(row.ended_at),
    isCurrent: Boolean(row.is_current),
    lastProviderEventCreatedAt: toNullableIsoString(row.last_provider_event_created_at),
    lastProviderEventId: row.last_provider_event_id == null ? null : String(row.last_provider_event_id),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapSubscriptionItemRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    subscriptionId: Number(row.subscription_id),
    provider: normalizeProvider(row.provider),
    providerSubscriptionItemId: String(row.provider_subscription_item_id || ""),
    billingPlanPriceId: row.billing_plan_price_id == null ? null : Number(row.billing_plan_price_id),
    billingComponent: String(row.billing_component || "base"),
    usageType: String(row.usage_type || "licensed"),
    quantity: row.quantity == null ? null : Number(row.quantity),
    isActive: Boolean(row.is_active),
    lastProviderEventCreatedAt: toNullableIsoString(row.last_provider_event_created_at),
    lastProviderEventId: row.last_provider_event_id == null ? null : String(row.last_provider_event_id),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapInvoiceRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    subscriptionId: row.subscription_id == null ? null : Number(row.subscription_id),
    billableEntityId: Number(row.billable_entity_id),
    billingCustomerId: Number(row.billing_customer_id),
    provider: normalizeProvider(row.provider),
    providerInvoiceId: String(row.provider_invoice_id || ""),
    status: String(row.status || ""),
    amountDueMinor: Number(row.amount_due_minor || 0),
    amountPaidMinor: Number(row.amount_paid_minor || 0),
    amountRemainingMinor: Number(row.amount_remaining_minor || 0),
    currency: String(row.currency || "").toUpperCase(),
    issuedAt: toNullableIsoString(row.issued_at),
    dueAt: toNullableIsoString(row.due_at),
    paidAt: toNullableIsoString(row.paid_at),
    lastProviderEventCreatedAt: toNullableIsoString(row.last_provider_event_created_at),
    lastProviderEventId: row.last_provider_event_id == null ? null : String(row.last_provider_event_id),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapPaymentRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    invoiceId: Number(row.invoice_id),
    provider: normalizeProvider(row.provider),
    providerPaymentId: String(row.provider_payment_id || ""),
    type: String(row.type || ""),
    status: String(row.status || ""),
    amountMinor: Number(row.amount_minor || 0),
    currency: String(row.currency || "").toUpperCase(),
    paidAt: toNullableIsoString(row.paid_at),
    lastProviderEventCreatedAt: toNullableIsoString(row.last_provider_event_created_at),
    lastProviderEventId: row.last_provider_event_id == null ? null : String(row.last_provider_event_id),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapPaymentMethodRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    billableEntityId: Number(row.billable_entity_id),
    billingCustomerId: Number(row.billing_customer_id),
    provider: normalizeProvider(row.provider),
    providerPaymentMethodId: String(row.provider_payment_method_id || ""),
    type: String(row.type || ""),
    brand: row.brand == null ? null : String(row.brand),
    last4: row.last4 == null ? null : String(row.last4),
    expMonth: row.exp_month == null ? null : Number(row.exp_month),
    expYear: row.exp_year == null ? null : Number(row.exp_year),
    isDefault: Boolean(row.is_default),
    status: String(row.status || "active"),
    lastProviderSyncedAt: toNullableIsoString(row.last_provider_synced_at),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapPaymentMethodSyncEventRowNullable(row) {
  if (!row) {
    return null;
  }

  const eventTypeValue =
    toNullableString(row.event_name) ||
    toNullableString(row.event_type) ||
    "manual_sync";

  return {
    id: Number(row.id),
    billableEntityId: row.billable_entity_id == null ? null : Number(row.billable_entity_id),
    billingCustomerId: row.billing_customer_id == null ? null : Number(row.billing_customer_id),
    provider: normalizeProvider(row.provider),
    eventType: String(eventTypeValue),
    providerEventId: row.provider_event_id == null ? null : String(row.provider_event_id),
    status: String(row.status || "succeeded"),
    errorText: row.error_text == null ? null : String(row.error_text),
    payloadJson: parseJsonValue(row.payload_json, null),
    processedAt: toNullableIsoString(row.processed_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapUsageCounterRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    billableEntityId: Number(row.billable_entity_id),
    entitlementCode: String(row.entitlement_code || ""),
    windowStartAt: toIsoString(row.window_start_at),
    windowEndAt: toIsoString(row.window_end_at),
    usageCount: Number(row.usage_count || 0),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapUsageEventRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    billableEntityId: Number(row.billable_entity_id),
    entitlementCode: String(row.entitlement_code || ""),
    usageEventKey: String(row.usage_event_key || ""),
    windowStartAt: toIsoString(row.window_start_at),
    windowEndAt: toIsoString(row.window_end_at),
    amount: Number(row.amount || 0),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapBillingActivityRowNullable(row) {
  if (!row) {
    return null;
  }

  const occurredAtValue = row.occurred_at || row.created_at || row.updated_at || null;
  const source = String(row.source || "").trim();
  const sourceId = Number(row.source_id || 0);

  return {
    id: `${source || "event"}:${sourceId || 0}`,
    source,
    sourceId,
    billableEntityId: row.billable_entity_id == null ? null : Number(row.billable_entity_id),
    workspaceId: row.workspace_id == null ? null : Number(row.workspace_id),
    workspaceSlug: toNullableString(row.workspace_slug),
    workspaceName: toNullableString(row.workspace_name),
    ownerUserId: row.owner_user_id == null ? null : Number(row.owner_user_id),
    provider: row.provider == null ? null : normalizeProvider(row.provider),
    operationKey: toNullableString(row.operation_key),
    providerEventId: toNullableString(row.provider_event_id),
    eventType: toNullableString(row.event_type) || "",
    status: toNullableString(row.status) || "",
    message: toNullableString(row.message),
    occurredAt: occurredAtValue ? toIsoString(occurredAtValue) : toIsoString(new Date()),
    detailsJson: parseJsonValue(row.details_json, null)
  };
}

function mapIdempotencyRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    billableEntityId: Number(row.billable_entity_id),
    action: String(row.action || ""),
    clientIdempotencyKey: String(row.client_idempotency_key || ""),
    requestFingerprintHash: String(row.request_fingerprint_hash || ""),
    normalizedRequestJson: parseJsonValue(row.normalized_request_json, {}),
    operationKey: String(row.operation_key || ""),
    providerRequestParamsJson: parseJsonValue(row.provider_request_params_json, null),
    providerRequestHash: row.provider_request_hash == null ? null : String(row.provider_request_hash),
    providerRequestSchemaVersion:
      row.provider_request_schema_version == null ? null : String(row.provider_request_schema_version),
    providerSdkName: row.provider_sdk_name == null ? null : String(row.provider_sdk_name),
    providerSdkVersion: row.provider_sdk_version == null ? null : String(row.provider_sdk_version),
    providerApiVersion: row.provider_api_version == null ? null : String(row.provider_api_version),
    providerRequestFrozenAt: toNullableIsoString(row.provider_request_frozen_at),
    provider: normalizeProvider(row.provider),
    providerIdempotencyKey: String(row.provider_idempotency_key || ""),
    providerIdempotencyReplayDeadlineAt: toNullableIsoString(row.provider_idempotency_replay_deadline_at),
    providerCheckoutSessionExpiresAtUpperBound: toNullableIsoString(row.provider_checkout_session_expires_at_upper_bound),
    providerSessionId: row.provider_session_id == null ? null : String(row.provider_session_id),
    responseJson: parseJsonValue(row.response_json, null),
    status: String(row.status || BILLING_IDEMPOTENCY_STATUS.PENDING),
    pendingLeaseExpiresAt: toNullableIsoString(row.pending_lease_expires_at),
    pendingLastHeartbeatAt: toNullableIsoString(row.pending_last_heartbeat_at),
    leaseOwner: row.lease_owner == null ? null : String(row.lease_owner),
    leaseVersion: Number(row.lease_version || 0),
    recoveryAttemptCount: Number(row.recovery_attempt_count || 0),
    lastRecoveryAttemptAt: toNullableIsoString(row.last_recovery_attempt_at),
    failureCode: row.failure_code == null ? null : String(row.failure_code),
    failureReason: row.failure_reason == null ? null : String(row.failure_reason),
    expiresAt: toNullableIsoString(row.expires_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapCheckoutSessionRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    billableEntityId: Number(row.billable_entity_id),
    provider: normalizeProvider(row.provider),
    providerCheckoutSessionId: row.provider_checkout_session_id == null ? null : String(row.provider_checkout_session_id),
    idempotencyRowId: row.idempotency_row_id == null ? null : Number(row.idempotency_row_id),
    operationKey: String(row.operation_key || ""),
    providerCustomerId: row.provider_customer_id == null ? null : String(row.provider_customer_id),
    providerSubscriptionId: row.provider_subscription_id == null ? null : String(row.provider_subscription_id),
    status: String(row.status || BILLING_CHECKOUT_SESSION_STATUS.OPEN),
    checkoutUrl: row.checkout_url == null ? null : String(row.checkout_url),
    expiresAt: toNullableIsoString(row.expires_at),
    completedAt: toNullableIsoString(row.completed_at),
    lastProviderEventCreatedAt: toNullableIsoString(row.last_provider_event_created_at),
    lastProviderEventId: row.last_provider_event_id == null ? null : String(row.last_provider_event_id),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapWebhookEventRowNullable(row) {
  if (!row) {
    return null;
  }

  const eventTypeValue =
    toNullableString(row.event_name) ||
    toNullableString(row.event_type) ||
    "";

  return {
    id: Number(row.id),
    billableEntityId: row.billable_entity_id == null ? null : Number(row.billable_entity_id),
    provider: normalizeProvider(row.provider),
    providerEventId: String(row.provider_event_id || ""),
    operationKey: toNullableString(row.operation_key),
    eventType: String(eventTypeValue),
    providerCreatedAt: toIsoString(row.provider_created_at || row.occurred_at || row.created_at),
    status: String(row.status || "received"),
    receivedAt: toIsoString(row.received_at || row.created_at),
    processingStartedAt: toNullableIsoString(row.processing_started_at),
    processedAt: toNullableIsoString(row.processed_at),
    lastFailedAt: toNullableIsoString(row.last_failed_at),
    attemptCount: Number(row.attempt_count || 0),
    payloadJson: parseJsonValue(row.payload_json, {}),
    payloadRetentionUntil: toNullableIsoString(row.payload_retention_until),
    errorText: row.error_text == null ? null : String(row.error_text),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapOutboxJobRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    billableEntityId: row.billable_entity_id == null ? null : Number(row.billable_entity_id),
    jobType: String(row.job_type || ""),
    dedupeKey: String(row.dedupe_key || ""),
    operationKey: toNullableString(row.operation_key),
    providerEventId: toNullableString(row.provider_event_id),
    payloadJson: parseJsonValue(row.payload_json, {}),
    status: String(row.status || "pending"),
    availableAt: toIsoString(row.available_at),
    attemptCount: Number(row.attempt_count || 0),
    leaseOwner: row.lease_owner == null ? null : String(row.lease_owner),
    leaseExpiresAt: toNullableIsoString(row.lease_expires_at),
    leaseVersion: Number(row.lease_version || 0),
    lastErrorText: row.last_error_text == null ? null : String(row.last_error_text),
    finishedAt: toNullableIsoString(row.finished_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapRemediationRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    billableEntityId: Number(row.billable_entity_id),
    provider: normalizeProvider(row.provider),
    operationKey: toNullableString(row.operation_key),
    providerEventId: toNullableString(row.provider_event_id),
    canonicalProviderSubscriptionId: String(row.canonical_provider_subscription_id || ""),
    canonicalSubscriptionId: row.canonical_subscription_id == null ? null : Number(row.canonical_subscription_id),
    duplicateProviderSubscriptionId: String(row.duplicate_provider_subscription_id || ""),
    action: String(row.action || ""),
    status: String(row.status || "pending"),
    selectionAlgorithmVersion: String(row.selection_algorithm_version || ""),
    attemptCount: Number(row.attempt_count || 0),
    nextAttemptAt: toNullableIsoString(row.next_attempt_at),
    lastAttemptAt: toNullableIsoString(row.last_attempt_at),
    resolvedAt: toNullableIsoString(row.resolved_at),
    leaseOwner: row.lease_owner == null ? null : String(row.lease_owner),
    leaseExpiresAt: toNullableIsoString(row.lease_expires_at),
    leaseVersion: Number(row.lease_version || 0),
    errorText: row.error_text == null ? null : String(row.error_text),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapReconciliationRunRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    provider: normalizeProvider(row.provider),
    scope: String(row.scope || ""),
    status: String(row.status || "running"),
    runnerId: row.runner_id == null ? null : String(row.runner_id),
    leaseExpiresAt: toNullableIsoString(row.lease_expires_at),
    leaseVersion: Number(row.lease_version || 0),
    startedAt: toIsoString(row.started_at),
    finishedAt: toNullableIsoString(row.finished_at),
    cursorJson: parseJsonValue(row.cursor_json, null),
    summaryJson: parseJsonValue(row.summary_json, null),
    scannedCount: Number(row.scanned_count || 0),
    driftDetectedCount: Number(row.drift_detected_count || 0),
    repairedCount: Number(row.repaired_count || 0),
    errorText: row.error_text == null ? null : String(row.error_text),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapPlanAssignmentRowNullable(row) {
  if (!row) {
    return null;
  }

  const status = String(row.status || (row.is_current ? "current" : "past"));

  return {
    id: Number(row.id),
    billableEntityId: Number(row.billable_entity_id),
    planId: Number(row.plan_id),
    source: String(row.source || "internal"),
    periodStartAt: toIsoString(row.period_start_at),
    periodEndAt: toIsoString(row.period_end_at),
    status,
    isCurrent: status === "current",
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapPlanAssignmentProviderDetailsRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    billingPlanAssignmentId: Number(row.billing_plan_assignment_id),
    provider: normalizeProvider(row.provider),
    providerSubscriptionId: String(row.provider_subscription_id || ""),
    providerCustomerId: row.provider_customer_id == null ? null : String(row.provider_customer_id),
    providerStatus: row.provider_status == null ? null : String(row.provider_status),
    providerSubscriptionCreatedAt: toNullableIsoString(row.provider_subscription_created_at),
    currentPeriodEnd: toNullableIsoString(row.current_period_end),
    trialEnd: toNullableIsoString(row.trial_end),
    canceledAt: toNullableIsoString(row.canceled_at),
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    endedAt: toNullableIsoString(row.ended_at),
    lastProviderEventCreatedAt: toNullableIsoString(row.last_provider_event_created_at),
    lastProviderEventId: row.last_provider_event_id == null ? null : String(row.last_provider_event_id),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapBillingPurchaseRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    billableEntityId: Number(row.billable_entity_id),
    workspaceId: row.workspace_id == null ? null : Number(row.workspace_id),
    provider: normalizeProvider(row.provider),
    purchaseKind: String(row.purchase_kind || ""),
    status: String(row.status || "confirmed"),
    amountMinor: Number(row.amount_minor || 0),
    currency: String(row.currency || "").toUpperCase(),
    quantity: row.quantity == null ? null : Number(row.quantity),
    operationKey: row.operation_key == null ? null : String(row.operation_key),
    providerCustomerId: row.provider_customer_id == null ? null : String(row.provider_customer_id),
    providerCheckoutSessionId:
      row.provider_checkout_session_id == null ? null : String(row.provider_checkout_session_id),
    providerPaymentId: row.provider_payment_id == null ? null : String(row.provider_payment_id),
    providerInvoiceId: row.provider_invoice_id == null ? null : String(row.provider_invoice_id),
    billingEventId: row.billing_event_id == null ? null : Number(row.billing_event_id),
    displayName: row.display_name == null ? null : String(row.display_name),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    dedupeKey: String(row.dedupe_key || ""),
    purchasedAt: toIsoString(row.purchased_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapPlanChangeHistoryRowNullable(row) {
  if (!row) {
    return null;
  }

  const changeKindValue =
    toNullableString(row.change_kind) ||
    toNullableString(row.event_name) ||
    toNullableString(row.event_type) ||
    "";

  return {
    id: Number(row.id),
    billableEntityId: row.billable_entity_id == null ? null : Number(row.billable_entity_id),
    fromPlanId: row.from_plan_id == null ? null : Number(row.from_plan_id),
    toPlanId: row.to_plan_id == null ? null : Number(row.to_plan_id),
    changeKind: String(changeKindValue),
    effectiveAt: toIsoString(row.effective_at || row.occurred_at || row.created_at),
    appliedByUserId:
      row.applied_by_user_id == null
        ? row.user_id == null
          ? null
          : Number(row.user_id)
        : Number(row.applied_by_user_id),
    scheduleId: row.schedule_id == null ? null : Number(row.schedule_id),
    metadataJson: parseJsonValue(row.metadata_json, parseJsonValue(row.payload_json, {})),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function toInsertDateTime(dateLike, fallback = new Date()) {
  const normalized = normalizeDateInput(dateLike) || fallback;
  return toMysqlDateTimeUtc(normalized);
}

function toNullableDateTime(dateLike) {
  const normalized = normalizeDateInput(dateLike);
  if (!normalized) {
    return null;
  }

  return toMysqlDateTimeUtc(normalized);
}

async function resolveWorkspaceIdForBillableEntity(client, billableEntityId) {
  const normalizedBillableEntityId = toPositiveInteger(billableEntityId);
  if (!normalizedBillableEntityId) {
    return null;
  }

  const row = await client("billable_entities")
    .where({ id: normalizedBillableEntityId })
    .select(["workspace_id"])
    .first();

  return row?.workspace_id == null ? null : Number(row.workspace_id);
}

function resolveQueryOptions(options = {}) {
  if (!options || typeof options !== "object") {
    return {
      trx: null,
      forUpdate: false
    };
  }

  return {
    trx: options.trx || null,
    forUpdate: options.forUpdate === true
  };
}

function createBillingRepository(dbClient) {
  function resolveClient(options = {}) {
    const { trx } = resolveQueryOptions(options);
    return trx || dbClient;
  }

  function applyForUpdate(query, options = {}) {
    const { forUpdate } = resolveQueryOptions(options);
    if (forUpdate && typeof query.forUpdate === "function") {
      return query.forUpdate();
    }

    return query;
  }

  async function transaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  async function findBillableEntityById(id, options = {}) {
    const client = resolveClient(options);
    const query = client("billable_entities").where({ id }).first();
    const row = await applyForUpdate(query, options);
    return mapBillableEntityRowNullable(row);
  }

  async function findBillableEntityByWorkspaceId(workspaceId, options = {}) {
    const client = resolveClient(options);
    const query = client("billable_entities").where({ workspace_id: workspaceId }).first();
    const row = await applyForUpdate(query, options);
    return mapBillableEntityRowNullable(row);
  }

  async function findBillableEntityByTypeRef({ entityType, entityRef }, options = {}) {
    const normalizedEntityRef = toNullableString(entityRef);
    if (!normalizedEntityRef) {
      return null;
    }

    const client = resolveClient(options);
    const query = client("billable_entities")
      .where({
        entity_type: normalizeBillableEntityType(entityType),
        entity_ref: normalizedEntityRef
      })
      .first();
    const row = await applyForUpdate(query, options);
    return mapBillableEntityRowNullable(row);
  }

  async function ensureBillableEntity({ workspaceId, ownerUserId }, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const existing = await findBillableEntityByWorkspaceId(workspaceId, {
      ...options,
      trx: client,
      forUpdate: true
    });
    if (existing) {
      return existing;
    }

    try {
      const [id] = await client("billable_entities").insert({
        workspace_id: workspaceId,
        owner_user_id: ownerUserId,
        entity_type: "workspace",
        entity_ref: null,
        status: "active",
        created_at: toInsertDateTime(now, now),
        updated_at: toInsertDateTime(now, now)
      });
      return findBillableEntityById(id, {
        ...options,
        trx: client
      });
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }

      return findBillableEntityByWorkspaceId(workspaceId, {
        ...options,
        trx: client,
        forUpdate: true
      });
    }
  }

  async function ensureBillableEntityByScope(payload = {}, options = {}) {
    const requestedType = String(payload?.entityType || "")
      .trim()
      .toLowerCase();
    if (requestedType && !BILLABLE_ENTITY_TYPES.has(requestedType)) {
      throw new Error("Unsupported billable entity type.");
    }

    const normalizedEntityType = normalizeBillableEntityType(requestedType || "workspace");
    if (normalizedEntityType === "workspace") {
      return ensureBillableEntity(
        {
          workspaceId: Number(payload.workspaceId),
          ownerUserId: Number(payload.ownerUserId)
        },
        options
      );
    }

    const normalizedEntityRef = toNullableString(payload.entityRef);
    if (!normalizedEntityRef) {
      throw new Error("entityRef is required for non-workspace billable entities.");
    }

    const now = new Date();
    const client = resolveClient(options);
    const existing = await findBillableEntityByTypeRef(
      {
        entityType: normalizedEntityType,
        entityRef: normalizedEntityRef
      },
      {
        ...options,
        trx: client,
        forUpdate: true
      }
    );
    if (existing) {
      return existing;
    }

    try {
      const [id] = await client("billable_entities").insert({
        entity_type: normalizedEntityType,
        entity_ref: normalizedEntityRef,
        workspace_id: toPositiveInteger(payload.workspaceId),
        owner_user_id: toPositiveInteger(payload.ownerUserId),
        status: toNullableString(payload.status) || "active",
        created_at: toInsertDateTime(now, now),
        updated_at: toInsertDateTime(now, now)
      });
      return findBillableEntityById(id, {
        ...options,
        trx: client
      });
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }

      return findBillableEntityByTypeRef(
        {
          entityType: normalizedEntityType,
          entityRef: normalizedEntityRef
        },
        {
          ...options,
          trx: client,
          forUpdate: true
        }
      );
    }
  }

  async function listPlans(options = {}) {
    const client = resolveClient(options);
    const rows = await client("billing_plans").orderBy("is_active", "desc").orderBy("id", "asc");
    return rows.map(mapPlanRowNullable).filter(Boolean);
  }

  async function findPlanByCode(code, options = {}) {
    const client = resolveClient(options);
    const row = await client("billing_plans").where({ code }).first();
    return mapPlanRowNullable(row);
  }

  async function findPlanById(id, options = {}) {
    const client = resolveClient(options);
    const row = await client("billing_plans").where({ id }).first();
    return mapPlanRowNullable(row);
  }

  async function findPlanByCheckoutProviderPriceId({ provider, providerPriceId }, options = {}) {
    const normalizedProvider = normalizeProvider(provider);
    const normalizedProviderPriceId = String(providerPriceId || "").trim();
    if (!normalizedProviderPriceId) {
      return null;
    }

    const client = resolveClient(options);
    const query = client("billing_plans")
      .where({
        checkout_provider: normalizedProvider,
        checkout_provider_price_id: normalizedProviderPriceId
      })
      .first();

    const row = await applyForUpdate(query, options);
    return mapPlanRowNullable(row);
  }

  async function listPlanEntitlementsForPlan(planId, options = {}) {
    void planId;
    void options;
    return [];
  }

  async function createPlan(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const corePrice = payload?.corePrice && typeof payload.corePrice === "object" ? payload.corePrice : {};
    const [id] = await client("billing_plans").insert({
      code: String(payload?.code || "").trim(),
      name: String(payload?.name || "").trim(),
      description: toNullableString(payload?.description),
      applies_to: String(payload?.appliesTo || "workspace").trim().toLowerCase() || "workspace",
      checkout_provider: normalizeProvider(corePrice.provider),
      checkout_provider_price_id: String(corePrice.providerPriceId || "").trim(),
      checkout_provider_product_id: toNullableString(corePrice.providerProductId),
      checkout_interval: String(corePrice.interval || "month").trim().toLowerCase() || "month",
      checkout_interval_count: Number(corePrice.intervalCount || 1),
      checkout_currency: String(corePrice.currency || "").trim().toUpperCase(),
      checkout_unit_amount_minor: Number(corePrice.unitAmountMinor || 0),
      is_active: payload?.isActive !== false,
      metadata_json: payload?.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
      created_at: toInsertDateTime(payload?.createdAt, now),
      updated_at: toInsertDateTime(payload?.updatedAt, now)
    });

    return findPlanById(id, {
      ...options,
      trx: client
    });
  }

  async function updatePlanById(id, patch = {}, options = {}) {
    const client = resolveClient(options);
    const dbPatch = {};

    if (Object.hasOwn(patch, "code")) {
      dbPatch.code = String(patch.code || "").trim();
    }
    if (Object.hasOwn(patch, "name")) {
      dbPatch.name = String(patch.name || "").trim();
    }
    if (Object.hasOwn(patch, "description")) {
      dbPatch.description = toNullableString(patch.description);
    }
    if (Object.hasOwn(patch, "appliesTo")) {
      dbPatch.applies_to = String(patch.appliesTo || "workspace").trim().toLowerCase() || "workspace";
    }
    if (Object.hasOwn(patch, "isActive")) {
      dbPatch.is_active = patch.isActive !== false;
    }
    if (Object.hasOwn(patch, "metadataJson")) {
      dbPatch.metadata_json = patch.metadataJson == null ? null : JSON.stringify(patch.metadataJson);
    }

    const corePricePatch = patch?.corePrice && typeof patch.corePrice === "object" ? patch.corePrice : null;
    if (corePricePatch) {
      if (Object.hasOwn(corePricePatch, "provider")) {
        dbPatch.checkout_provider = normalizeProvider(corePricePatch.provider);
      }
      if (Object.hasOwn(corePricePatch, "providerPriceId")) {
        dbPatch.checkout_provider_price_id = String(corePricePatch.providerPriceId || "").trim();
      }
      if (Object.hasOwn(corePricePatch, "providerProductId")) {
        dbPatch.checkout_provider_product_id = toNullableString(corePricePatch.providerProductId);
      }
      if (Object.hasOwn(corePricePatch, "interval")) {
        dbPatch.checkout_interval = String(corePricePatch.interval || "month").trim().toLowerCase() || "month";
      }
      if (Object.hasOwn(corePricePatch, "intervalCount")) {
        dbPatch.checkout_interval_count = Number(corePricePatch.intervalCount || 1);
      }
      if (Object.hasOwn(corePricePatch, "currency")) {
        dbPatch.checkout_currency = String(corePricePatch.currency || "").trim().toUpperCase();
      }
      if (Object.hasOwn(corePricePatch, "unitAmountMinor")) {
        dbPatch.checkout_unit_amount_minor = Number(corePricePatch.unitAmountMinor || 0);
      }
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toInsertDateTime(new Date(), new Date());
      await client("billing_plans").where({ id }).update(dbPatch);
    }

    return findPlanById(id, {
      ...options,
      trx: client
    });
  }

  async function listProducts(options = {}) {
    const client = resolveClient(options);
    const rows = await client("billing_products").orderBy("is_active", "desc").orderBy("id", "asc");
    return rows.map(mapProductRowNullable).filter(Boolean);
  }

  async function findProductByCode(code, options = {}) {
    const client = resolveClient(options);
    const row = await client("billing_products").where({ code }).first();
    return mapProductRowNullable(row);
  }

  async function findProductById(id, options = {}) {
    const client = resolveClient(options);
    const row = await client("billing_products").where({ id }).first();
    return mapProductRowNullable(row);
  }

  async function createProduct(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const price = payload?.price && typeof payload.price === "object" ? payload.price : {};
    const [id] = await client("billing_products").insert({
      code: String(payload?.code || "").trim(),
      name: String(payload?.name || "").trim(),
      description: toNullableString(payload?.description),
      product_kind: String(payload?.productKind || "one_off").trim().toLowerCase() || "one_off",
      provider: normalizeProvider(price.provider),
      provider_price_id: String(price.providerPriceId || "").trim(),
      provider_product_id: toNullableString(price.providerProductId),
      price_interval: toNullableString(price.interval),
      price_interval_count: price.intervalCount == null ? null : Number(price.intervalCount),
      currency: String(price.currency || "").trim().toUpperCase(),
      unit_amount_minor: Number(price.unitAmountMinor || 0),
      is_active: payload?.isActive !== false,
      metadata_json: payload?.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
      created_at: toInsertDateTime(payload?.createdAt, now),
      updated_at: toInsertDateTime(payload?.updatedAt, now)
    });

    return findProductById(id, {
      ...options,
      trx: client
    });
  }

  async function updateProductById(id, patch = {}, options = {}) {
    const client = resolveClient(options);
    const dbPatch = {};

    if (Object.hasOwn(patch, "code")) {
      dbPatch.code = String(patch.code || "").trim();
    }
    if (Object.hasOwn(patch, "name")) {
      dbPatch.name = String(patch.name || "").trim();
    }
    if (Object.hasOwn(patch, "description")) {
      dbPatch.description = toNullableString(patch.description);
    }
    if (Object.hasOwn(patch, "productKind")) {
      dbPatch.product_kind = String(patch.productKind || "one_off").trim().toLowerCase() || "one_off";
    }
    if (Object.hasOwn(patch, "isActive")) {
      dbPatch.is_active = patch.isActive !== false;
    }
    if (Object.hasOwn(patch, "metadataJson")) {
      dbPatch.metadata_json = patch.metadataJson == null ? null : JSON.stringify(patch.metadataJson);
    }

    const pricePatch = patch?.price && typeof patch.price === "object" ? patch.price : null;
    if (pricePatch) {
      if (Object.hasOwn(pricePatch, "provider")) {
        dbPatch.provider = normalizeProvider(pricePatch.provider);
      }
      if (Object.hasOwn(pricePatch, "providerPriceId")) {
        dbPatch.provider_price_id = String(pricePatch.providerPriceId || "").trim();
      }
      if (Object.hasOwn(pricePatch, "providerProductId")) {
        dbPatch.provider_product_id = toNullableString(pricePatch.providerProductId);
      }
      if (Object.hasOwn(pricePatch, "interval")) {
        dbPatch.price_interval = toNullableString(pricePatch.interval);
      }
      if (Object.hasOwn(pricePatch, "intervalCount")) {
        dbPatch.price_interval_count = pricePatch.intervalCount == null ? null : Number(pricePatch.intervalCount);
      }
      if (Object.hasOwn(pricePatch, "currency")) {
        dbPatch.currency = String(pricePatch.currency || "").trim().toUpperCase();
      }
      if (Object.hasOwn(pricePatch, "unitAmountMinor")) {
        dbPatch.unit_amount_minor = Number(pricePatch.unitAmountMinor || 0);
      }
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toInsertDateTime(new Date(), new Date());
      await client("billing_products").where({ id }).update(dbPatch);
    }

    return findProductById(id, {
      ...options,
      trx: client
    });
  }

  async function upsertPlanEntitlement(payload, options = {}) {
    void options;
    if (!payload || typeof payload !== "object") {
      return null;
    }
    return {
      id: null,
      planId: Number(payload.planId),
      code: String(payload.code || "").trim(),
      schemaVersion: String(payload.schemaVersion || "").trim(),
      valueJson: payload.valueJson ?? {},
      createdAt: toNullableDateTime(payload.createdAt) || new Date(),
      updatedAt: toNullableDateTime(payload.updatedAt) || new Date()
    };
  }

  async function findPlanAssignmentById(id, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_plan_assignments").where({ id: Number(id) }).first();
    const row = await applyForUpdate(query, options);
    return mapPlanAssignmentRowNullable(row);
  }

  async function findCurrentPlanAssignmentForEntity(billableEntityId, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_plan_assignments")
      .where({
        billable_entity_id: Number(billableEntityId),
        status: "current"
      })
      .orderBy("id", "asc")
      .first();
    const row = await applyForUpdate(query, options);
    return mapPlanAssignmentRowNullable(row);
  }

  async function findUpcomingPlanAssignmentForEntity(billableEntityId, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_plan_assignments")
      .where({
        billable_entity_id: Number(billableEntityId),
        status: "upcoming"
      })
      .orderBy("id", "asc")
      .first();
    const row = await applyForUpdate(query, options);
    return mapPlanAssignmentRowNullable(row);
  }

  async function listPlanAssignmentsForEntity({ billableEntityId, statuses = null, limit = 100 } = {}, options = {}) {
    const client = resolveClient(options);
    let query = client("billing_plan_assignments")
      .where({ billable_entity_id: Number(billableEntityId) })
      .orderBy("period_start_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(500, Number(limit) || 100)));

    if (Array.isArray(statuses) && statuses.length > 0) {
      query = query.whereIn(
        "status",
        statuses.map((value) => String(value || "").trim()).filter(Boolean)
      );
    }

    const rows = await query;
    return rows.map(mapPlanAssignmentRowNullable).filter(Boolean);
  }

  async function updatePlanAssignmentById(id, patch = {}, options = {}) {
    const client = resolveClient(options);
    const dbPatch = {};

    if (Object.hasOwn(patch, "planId")) {
      dbPatch.plan_id = Number(patch.planId);
    }
    if (Object.hasOwn(patch, "source")) {
      dbPatch.source = String(patch.source || "internal").trim() || "internal";
    }
    if (Object.hasOwn(patch, "status")) {
      dbPatch.status = String(patch.status || "past").trim() || "past";
    }
    if (Object.hasOwn(patch, "periodStartAt")) {
      dbPatch.period_start_at = toInsertDateTime(patch.periodStartAt, new Date());
    }
    if (Object.hasOwn(patch, "periodEndAt")) {
      dbPatch.period_end_at = toInsertDateTime(patch.periodEndAt, new Date());
    }
    if (Object.hasOwn(patch, "metadataJson")) {
      dbPatch.metadata_json = patch.metadataJson == null ? null : JSON.stringify(patch.metadataJson);
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toInsertDateTime(new Date(), new Date());
      await client("billing_plan_assignments").where({ id: Number(id) }).update(dbPatch);
    }

    return findPlanAssignmentById(id, {
      ...options,
      trx: client
    });
  }

  async function clearCurrentPlanAssignmentsForEntity(billableEntityId, options = {}) {
    const client = resolveClient(options);
    await client("billing_plan_assignments")
      .where({
        billable_entity_id: Number(billableEntityId),
        status: "current"
      })
      .update({
        status: "past",
        updated_at: toInsertDateTime(new Date(), new Date())
      });
  }

  async function cancelUpcomingPlanAssignmentForEntity(
    { billableEntityId, metadataJson = null, canceledByUserId = null } = {},
    options = {}
  ) {
    const client = resolveClient(options);
    const upcoming = await findUpcomingPlanAssignmentForEntity(billableEntityId, {
      ...options,
      trx: client,
      forUpdate: true
    });
    if (!upcoming) {
      return null;
    }

    const nextMetadata = {
      ...(upcoming.metadataJson && typeof upcoming.metadataJson === "object" ? upcoming.metadataJson : {}),
      ...(metadataJson && typeof metadataJson === "object" ? metadataJson : {})
    };
    if (canceledByUserId != null) {
      nextMetadata.canceledByUserId = Number(canceledByUserId);
    }

    await client("billing_plan_assignments")
      .where({ id: Number(upcoming.id) })
      .update({
        status: "canceled",
        metadata_json: JSON.stringify(nextMetadata),
        updated_at: toInsertDateTime(new Date(), new Date())
      });

    return findPlanAssignmentById(upcoming.id, {
      ...options,
      trx: client
    });
  }

  async function replaceUpcomingPlanAssignmentForEntity(payload, options = {}) {
    const client = resolveClient(options);
    const now = new Date();
    const normalizedBillableEntityId = Number(payload?.billableEntityId);

    await cancelUpcomingPlanAssignmentForEntity(
      {
        billableEntityId: normalizedBillableEntityId,
        metadataJson: {
          replacedBy: "replaceUpcomingPlanAssignmentForEntity"
        },
        canceledByUserId: payload?.requestedByUserId == null ? null : Number(payload.requestedByUserId)
      },
      {
        ...options,
        trx: client
      }
    );

    return insertPlanAssignment(
      {
        billableEntityId: normalizedBillableEntityId,
        planId: Number(payload?.targetPlanId || payload?.planId),
        source: String(payload?.source || (payload?.changeKind === "promo_fallback" ? "promo" : "manual"))
          .trim()
          .toLowerCase() || "manual",
        status: "upcoming",
        periodStartAt: payload?.effectiveAt || now,
        periodEndAt:
          payload?.periodEndAt ||
          new Date(new Date(payload?.effectiveAt || now).getTime() + 30 * 24 * 60 * 60 * 1000),
        metadataJson: {
          ...(payload?.metadataJson && typeof payload.metadataJson === "object" ? payload.metadataJson : {}),
          changeKind: payload?.changeKind || "downgrade",
          requestedByUserId: payload?.requestedByUserId == null ? null : Number(payload.requestedByUserId),
          fromPlanId: payload?.fromPlanId == null ? null : Number(payload.fromPlanId)
        }
      },
      {
        ...options,
        trx: client
      }
    );
  }

  async function listDueUpcomingPlanAssignments({ periodStartAtOrBefore, limit = 50 } = {}, options = {}) {
    const client = resolveClient(options);
    const threshold = periodStartAtOrBefore || new Date();
    const rows = await client("billing_plan_assignments")
      .where({ status: "upcoming" })
      .andWhere("period_start_at", "<=", toInsertDateTime(threshold, threshold))
      .orderBy("period_start_at", "asc")
      .orderBy("id", "asc")
      .limit(Math.max(1, Math.min(200, Number(limit) || 50)));
    return rows.map(mapPlanAssignmentRowNullable).filter(Boolean);
  }

  async function insertPlanAssignment(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);

    const normalizedBillableEntityId = Number(payload?.billableEntityId);
    const normalizedPlanId = Number(payload?.planId);
    const explicitStatus = toNullableString(payload?.status);
    const resolvedStatus = explicitStatus || (payload?.isCurrent === false ? "past" : "current");

    if (resolvedStatus === "current") {
      await clearCurrentPlanAssignmentsForEntity(normalizedBillableEntityId, {
        ...options,
        trx: client
      });
    }
    if (resolvedStatus === "upcoming") {
      await cancelUpcomingPlanAssignmentForEntity(
        {
          billableEntityId: normalizedBillableEntityId,
          metadataJson: {
            replacedByInsert: true
          }
        },
        {
          ...options,
          trx: client
        }
      );
    }

    const [id] = await client("billing_plan_assignments").insert({
      billable_entity_id: normalizedBillableEntityId,
      plan_id: normalizedPlanId,
      source: String(payload?.source || "internal").trim() || "internal",
      status: resolvedStatus,
      period_start_at: toInsertDateTime(payload?.periodStartAt, now),
      period_end_at: toInsertDateTime(payload?.periodEndAt, now),
      metadata_json: payload?.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
      created_at: toInsertDateTime(payload?.createdAt, now),
      updated_at: toInsertDateTime(payload?.updatedAt, now)
    });

    return findPlanAssignmentById(id, {
      ...options,
      trx: client
    });
  }

  async function insertPlanChangeHistory(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const normalizedBillableEntityId = toPositiveInteger(payload?.billableEntityId);
    const normalizedEffectiveAt = toInsertDateTime(payload?.effectiveAt, now);
    const [id] = await client("billing_events").insert({
      event_type: "plan_change",
      event_name: String(payload?.changeKind || "").trim() || "plan_change",
      billable_entity_id: normalizedBillableEntityId,
      workspace_id: await resolveWorkspaceIdForBillableEntity(client, normalizedBillableEntityId),
      user_id: toPositiveInteger(payload?.appliedByUserId),
      from_plan_id: payload?.fromPlanId == null ? null : Number(payload.fromPlanId),
      to_plan_id: payload?.toPlanId == null ? null : Number(payload.toPlanId),
      effective_at: normalizedEffectiveAt,
      occurred_at: normalizedEffectiveAt,
      status: "applied",
      payload_json: payload?.metadataJson == null ? JSON.stringify({}) : JSON.stringify(payload.metadataJson),
      metadata_json: payload?.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
      created_at: toInsertDateTime(payload?.createdAt, now),
      updated_at: toInsertDateTime(payload?.updatedAt, now)
    });

    const row = await client("billing_events")
      .where({
        id,
        event_type: "plan_change"
      })
      .first();
    return mapPlanChangeHistoryRowNullable(row);
  }

  async function listPlanChangeHistoryForEntity({ billableEntityId, limit = 20 } = {}, options = {}) {
    const client = resolveClient(options);
    const rows = await client("billing_plan_assignments")
      .where({ billable_entity_id: Number(billableEntityId) })
      .whereIn("status", ["current", "past"])
      .orderBy("period_start_at", "asc")
      .orderBy("id", "asc");

    const assignments = rows.map(mapPlanAssignmentRowNullable).filter(Boolean);
    const entries = [];
    let previous = null;
    for (const assignment of assignments) {
      const metadataJson = assignment.metadataJson && typeof assignment.metadataJson === "object" ? assignment.metadataJson : {};
      entries.push({
        id: Number(assignment.id),
        billableEntityId: Number(assignment.billableEntityId),
        fromPlanId: previous ? Number(previous.planId) : null,
        toPlanId: Number(assignment.planId),
        changeKind: String(metadataJson.changeKind || `${assignment.source || "internal"}_effective`),
        effectiveAt: assignment.periodStartAt,
        appliedByUserId:
          metadataJson.appliedByUserId == null ? null : Number(metadataJson.appliedByUserId),
        scheduleId: null,
        metadataJson,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt
      });
      previous = assignment;
    }

    return entries.reverse().slice(0, Math.max(1, Math.min(200, Number(limit) || 20)));
  }

  async function findCustomerById(id, options = {}) {
    const client = resolveClient(options);
    const row = await client("billing_customers").where({ id }).first();
    return mapCustomerRowNullable(row);
  }

  async function findCustomerByEntityProvider({ billableEntityId, provider }, options = {}) {
    const client = resolveClient(options);
    const row = await client("billing_customers")
      .where({ billable_entity_id: billableEntityId, provider: normalizeProvider(provider) })
      .first();

    return mapCustomerRowNullable(row);
  }

  async function findCustomerByProviderCustomerId({ provider, providerCustomerId }, options = {}) {
    const client = resolveClient(options);
    const row = await client("billing_customers")
      .where({ provider: normalizeProvider(provider), provider_customer_id: providerCustomerId })
      .first();

    return mapCustomerRowNullable(row);
  }

  async function upsertCustomer(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const provider = normalizeProvider(payload.provider);

    await client("billing_customers")
      .insert({
        billable_entity_id: payload.billableEntityId,
        provider,
        provider_customer_id: payload.providerCustomerId,
        email: payload.email || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        created_at: toInsertDateTime(payload.createdAt, now),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      })
      .onConflict(["provider", "provider_customer_id"])
      .merge({
        billable_entity_id: payload.billableEntityId,
        email: payload.email || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      });

    return findCustomerByProviderCustomerId(
      {
        provider,
        providerCustomerId: payload.providerCustomerId
      },
      options
    );
  }

  function applySubscriptionProjectionSelect(query, client) {
    return query.select(
      "bpa.id as id",
      "bpa.billable_entity_id",
      "bpa.plan_id",
      "bc.id as billing_customer_id",
      "bpad.provider",
      "bpad.provider_customer_id",
      "bpad.provider_subscription_id",
      "bpad.provider_status as status",
      "bpad.provider_subscription_created_at",
      "bpad.current_period_end",
      "bpad.trial_end",
      "bpad.canceled_at",
      "bpad.cancel_at_period_end",
      "bpad.ended_at",
      client.raw("CASE WHEN bpa.status = 'current' THEN 1 ELSE 0 END as is_current"),
      "bpad.last_provider_event_created_at",
      "bpad.last_provider_event_id",
      "bpad.metadata_json",
      "bpad.created_at",
      "bpad.updated_at"
    );
  }

  function buildSubscriptionProjectionQuery(client) {
    return client("billing_plan_assignment_provider_details as bpad")
      .join("billing_plan_assignments as bpa", "bpa.id", "bpad.billing_plan_assignment_id")
      .leftJoin("billing_customers as bc", function joinBillingCustomer() {
        this.on("bc.billable_entity_id", "=", "bpa.billable_entity_id")
          .andOn("bc.provider", "=", "bpad.provider")
          .andOn("bc.provider_customer_id", "=", "bpad.provider_customer_id");
      });
  }

  async function findPlanAssignmentProviderDetailsByAssignmentId(billingPlanAssignmentId, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_plan_assignment_provider_details")
      .where({ billing_plan_assignment_id: Number(billingPlanAssignmentId) })
      .first();
    const row = await applyForUpdate(query, options);
    return mapPlanAssignmentProviderDetailsRowNullable(row);
  }

  async function upsertPlanAssignmentProviderDetails(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const assignmentId = Number(payload?.billingPlanAssignmentId || payload?.planAssignmentId);
    const provider = normalizeProvider(payload?.provider);
    const dbPayload = {
      billing_plan_assignment_id: assignmentId,
      provider,
      provider_subscription_id: String(payload?.providerSubscriptionId || "").trim(),
      provider_customer_id: toNullableString(payload?.providerCustomerId),
      provider_status: toNullableString(payload?.providerStatus),
      provider_subscription_created_at: toNullableDateTime(payload?.providerSubscriptionCreatedAt),
      current_period_end: toNullableDateTime(payload?.currentPeriodEnd),
      trial_end: toNullableDateTime(payload?.trialEnd),
      canceled_at: toNullableDateTime(payload?.canceledAt),
      cancel_at_period_end: Boolean(payload?.cancelAtPeriodEnd),
      ended_at: toNullableDateTime(payload?.endedAt),
      last_provider_event_created_at: toNullableDateTime(payload?.lastProviderEventCreatedAt),
      last_provider_event_id: toNullableString(payload?.lastProviderEventId),
      metadata_json: payload?.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
      updated_at: toInsertDateTime(payload?.updatedAt, now)
    };

    await client("billing_plan_assignment_provider_details")
      .insert({
        ...dbPayload,
        created_at: toInsertDateTime(payload?.createdAt, now)
      })
      .onConflict("billing_plan_assignment_id")
      .merge(dbPayload);

    return findPlanAssignmentProviderDetailsByAssignmentId(assignmentId, {
      ...options,
      trx: client
    });
  }

  async function findPlanAssignmentByProviderSubscriptionId({ provider, providerSubscriptionId }, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_plan_assignments as bpa")
      .join(
        "billing_plan_assignment_provider_details as bpad",
        "bpad.billing_plan_assignment_id",
        "bpa.id"
      )
      .where({
        "bpad.provider": normalizeProvider(provider),
        "bpad.provider_subscription_id": String(providerSubscriptionId || "").trim()
      })
      .select("bpa.*")
      .first();
    const row = await applyForUpdate(query, options);
    return mapPlanAssignmentRowNullable(row);
  }

  async function findCurrentSubscriptionForEntity(billableEntityId, options = {}) {
    const client = resolveClient(options);
    const query = applySubscriptionProjectionSelect(
      buildSubscriptionProjectionQuery(client)
        .where({
          "bpa.billable_entity_id": Number(billableEntityId),
          "bpa.status": "current"
        })
        .orderBy("bpa.id", "asc")
        .first(),
      client
    );

    const row = await applyForUpdate(query, options);
    return mapSubscriptionRowNullable(row);
  }

  async function lockSubscriptionsForEntity(billableEntityId, options = {}) {
    const client = resolveClient(options);
    let query = applySubscriptionProjectionSelect(
      buildSubscriptionProjectionQuery(client)
        .where({ "bpa.billable_entity_id": Number(billableEntityId) })
        .orderBy("bpa.id", "asc"),
      client
    );
    if (resolveQueryOptions(options).forUpdate && typeof query.forUpdate === "function") {
      query = query.forUpdate();
    }

    const rows = await query;
    return rows.map(mapSubscriptionRowNullable).filter(Boolean);
  }

  async function findSubscriptionByProviderSubscriptionId({ provider, providerSubscriptionId }, options = {}) {
    const client = resolveClient(options);
    const query = applySubscriptionProjectionSelect(
      buildSubscriptionProjectionQuery(client)
        .where({
          "bpad.provider": normalizeProvider(provider),
          "bpad.provider_subscription_id": String(providerSubscriptionId || "").trim()
        })
        .first(),
      client
    );

    const row = await applyForUpdate(query, options);
    return mapSubscriptionRowNullable(row);
  }

  async function listCurrentSubscriptions({ provider, limit = 200 }, options = {}) {
    const client = resolveClient(options);
    const rows = await applySubscriptionProjectionSelect(
      buildSubscriptionProjectionQuery(client)
        .where({
          "bpad.provider": normalizeProvider(provider),
          "bpa.status": "current"
        })
        .orderBy("bpad.updated_at", "desc")
        .orderBy("bpa.id", "desc"),
      client
    )
      .limit(Math.max(1, Math.min(1000, Number(limit) || 200)));

    return rows.map(mapSubscriptionRowNullable).filter(Boolean);
  }

  async function clearCurrentSubscriptionFlagsForEntity(billableEntityId, options = {}) {
    void billableEntityId;
    void options;
    // Current provider-subscription selection now follows the current assignment row.
    return 0;
  }

  async function upsertSubscription(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const provider = normalizeProvider(payload.provider);
    const status = String(payload.status || BILLING_SUBSCRIPTION_STATUS.INCOMPLETE).trim();
    const isCurrentCandidate = Boolean(payload.isCurrent);
    const isCurrentAllowed = NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET.has(status);
    const isCurrent = isCurrentCandidate && isCurrentAllowed;
    const normalizedBillableEntityId = Number(payload.billableEntityId);
    const normalizedPlanId = Number(payload.planId);
    const providerSubscriptionId = String(payload.providerSubscriptionId || "").trim();

    const existingProviderRowQuery = client("billing_plan_assignment_provider_details as bpad")
      .join("billing_plan_assignments as bpa", "bpa.id", "bpad.billing_plan_assignment_id")
      .where({
        "bpad.provider": provider,
        "bpad.provider_subscription_id": providerSubscriptionId
      })
      .select(
        "bpad.*",
        "bpa.id as assignment_id",
        "bpa.billable_entity_id as assignment_billable_entity_id",
        "bpa.plan_id as assignment_plan_id",
        "bpa.status as assignment_status"
      )
      .first();
    const existingProviderRow = await applyForUpdate(existingProviderRowQuery, options);

    let targetAssignment = null;

    if (existingProviderRow) {
      targetAssignment = await findPlanAssignmentById(existingProviderRow.assignment_id, {
        ...options,
        trx: client,
        forUpdate: true
      });
    }

    if (isCurrent) {
      const currentAssignment = await findCurrentPlanAssignmentForEntity(normalizedBillableEntityId, {
        ...options,
        trx: client,
        forUpdate: true
      });
      if (currentAssignment && Number(currentAssignment.planId) === normalizedPlanId) {
        targetAssignment = currentAssignment;
      } else {
        if (currentAssignment) {
          await updatePlanAssignmentById(
            currentAssignment.id,
            {
              status: "past",
              periodEndAt: payload.currentPeriodEnd || payload.trialEnd || currentAssignment.periodEndAt,
              metadataJson: {
                ...(currentAssignment.metadataJson && typeof currentAssignment.metadataJson === "object"
                  ? currentAssignment.metadataJson
                  : {}),
                replacedByProviderSubscriptionId: providerSubscriptionId
              }
            },
            {
              ...options,
              trx: client
            }
          );
        }

        targetAssignment = await insertPlanAssignment(
          {
            billableEntityId: normalizedBillableEntityId,
            planId: normalizedPlanId,
            source: "internal",
            status: "current",
            periodStartAt: payload.providerSubscriptionCreatedAt || now,
            periodEndAt:
              payload.currentPeriodEnd ||
              payload.trialEnd ||
              new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            metadataJson: {
              provider,
              providerSubscriptionId,
              migratedBy: "upsertSubscription"
            }
          },
          {
            ...options,
            trx: client
          }
        );
      }
    }

    if (!targetAssignment) {
      targetAssignment =
        existingProviderRow &&
        Number(existingProviderRow.assignment_billable_entity_id) === normalizedBillableEntityId &&
        Number(existingProviderRow.assignment_plan_id) === normalizedPlanId
          ? await findPlanAssignmentById(existingProviderRow.assignment_id, {
              ...options,
              trx: client,
              forUpdate: true
            })
          : null;
    }

    if (!targetAssignment) {
      targetAssignment = await insertPlanAssignment(
        {
          billableEntityId: normalizedBillableEntityId,
          planId: normalizedPlanId,
          source: "internal",
          status: "past",
          periodStartAt: payload.providerSubscriptionCreatedAt || now,
          periodEndAt:
            payload.currentPeriodEnd ||
            payload.trialEnd ||
            new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          metadataJson: {
            provider,
            providerSubscriptionId,
            insertedAs: "provider_details_noncurrent"
          }
        },
        {
          ...options,
          trx: client
        }
      );
    }

    let providerCustomerId = toNullableString(payload.providerCustomerId);
    if (!providerCustomerId && payload.billingCustomerId) {
      const customer = await findCustomerById(payload.billingCustomerId, {
        ...options,
        trx: client
      });
      providerCustomerId = toNullableString(customer?.providerCustomerId);
    }
    if (!providerCustomerId && existingProviderRow) {
      providerCustomerId = toNullableString(existingProviderRow.provider_customer_id);
    }

    if (
      existingProviderRow &&
      Number(existingProviderRow.billing_plan_assignment_id) !== Number(targetAssignment.id)
    ) {
      await client("billing_plan_assignment_provider_details")
        .where({ billing_plan_assignment_id: Number(existingProviderRow.billing_plan_assignment_id) })
        .delete();
    }

    await upsertPlanAssignmentProviderDetails(
      {
        billingPlanAssignmentId: targetAssignment.id,
        provider,
        providerSubscriptionId,
        providerCustomerId,
        providerStatus: status,
        providerSubscriptionCreatedAt: payload.providerSubscriptionCreatedAt,
        currentPeriodEnd: payload.currentPeriodEnd,
        trialEnd: payload.trialEnd,
        canceledAt: payload.canceledAt,
        cancelAtPeriodEnd: Boolean(payload.cancelAtPeriodEnd),
        endedAt: payload.endedAt,
        lastProviderEventCreatedAt: payload.lastProviderEventCreatedAt,
        lastProviderEventId: payload.lastProviderEventId || null,
        metadataJson: payload.metadataJson == null ? {} : payload.metadataJson,
        createdAt: payload.createdAt || now,
        updatedAt: payload.updatedAt || now
      },
      {
        ...options,
        trx: client
      }
    );

    if (TERMINAL_SUBSCRIPTION_STATUS_SET.has(status) && targetAssignment.status === "current") {
      // Keep assignment state stable; provider status is terminal and callers gate on provider status.
    }

    return findSubscriptionByProviderSubscriptionId(
      {
        provider,
        providerSubscriptionId
      },
      {
        ...options,
        trx: client
      }
    );
  }

  async function listSubscriptionItemsForSubscription({ subscriptionId, provider }, options = {}) {
    void subscriptionId;
    void provider;
    void options;
    return [];
  }

  async function findSubscriptionItemByProviderSubscriptionItemId(
    { provider, providerSubscriptionItemId },
    options = {}
  ) {
    void provider;
    void providerSubscriptionItemId;
    void options;
    return null;
  }

  async function upsertSubscriptionItem(payload, options = {}) {
    void payload;
    void options;
    return null;
  }

  async function listInvoicesForSubscription({ subscriptionId, provider, limit = 20 }, options = {}) {
    void subscriptionId;
    void provider;
    void limit;
    void options;
    return [];
  }

  async function listRecentInvoices({ provider, since = null, limit = 200 }, options = {}) {
    void provider;
    void since;
    void limit;
    void options;
    return [];
  }

  async function findInvoiceByProviderInvoiceId({ provider, providerInvoiceId }, options = {}) {
    void provider;
    void providerInvoiceId;
    void options;
    return null;
  }

  async function upsertInvoice(payload, options = {}) {
    void payload;
    void options;
    return null;
  }

  async function listPaymentsForInvoiceIds({ provider, invoiceIds }, options = {}) {
    void provider;
    void invoiceIds;
    void options;
    return [];
  }

  async function findPaymentByProviderPaymentId({ provider, providerPaymentId }, options = {}) {
    void provider;
    void providerPaymentId;
    void options;
    return null;
  }

  async function upsertPayment(payload, options = {}) {
    void payload;
    void options;
    return null;
  }

  async function upsertBillingPurchase(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const normalizedBillableEntityId = Number(payload?.billableEntityId);
    const dedupeKey = String(payload?.dedupeKey || "").trim();
    if (!dedupeKey) {
      throw new Error("upsertBillingPurchase requires payload.dedupeKey.");
    }

    const rowPayload = {
      billable_entity_id: normalizedBillableEntityId,
      workspace_id:
        payload?.workspaceId == null ? await resolveWorkspaceIdForBillableEntity(client, normalizedBillableEntityId) : Number(payload.workspaceId),
      provider: normalizeProvider(payload?.provider),
      purchase_kind: String(payload?.purchaseKind || "").trim() || "one_off",
      status: String(payload?.status || "confirmed").trim() || "confirmed",
      amount_minor: Math.max(0, Number(payload?.amountMinor || 0)),
      currency: String(payload?.currency || "").trim().toUpperCase() || "USD",
      quantity: payload?.quantity == null ? 1 : Math.max(1, Number(payload.quantity || 1)),
      operation_key: toNullableString(payload?.operationKey),
      provider_customer_id: toNullableString(payload?.providerCustomerId),
      provider_checkout_session_id: toNullableString(payload?.providerCheckoutSessionId),
      provider_payment_id: toNullableString(payload?.providerPaymentId),
      provider_invoice_id: toNullableString(payload?.providerInvoiceId),
      billing_event_id: payload?.billingEventId == null ? null : Number(payload.billingEventId),
      display_name: toNullableString(payload?.displayName),
      metadata_json: payload?.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
      dedupe_key: dedupeKey,
      purchased_at: toInsertDateTime(payload?.purchasedAt, now),
      created_at: toInsertDateTime(payload?.createdAt, now),
      updated_at: toInsertDateTime(payload?.updatedAt, now)
    };

    await client("billing_purchases")
      .insert(rowPayload)
      .onConflict(["dedupe_key"])
      .ignore();

    const row = await client("billing_purchases").where({ dedupe_key: dedupeKey }).first();
    return mapBillingPurchaseRowNullable(row);
  }

  async function listBillingPurchasesForEntity({ billableEntityId, limit = 50, status = "confirmed" } = {}, options = {}) {
    const client = resolveClient(options);
    let query = client("billing_purchases")
      .where({ billable_entity_id: Number(billableEntityId) })
      .orderBy("purchased_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(200, Number(limit) || 50)));

    if (status) {
      query = query.andWhere("status", String(status || "").trim());
    }

    const rows = await query;
    return rows.map(mapBillingPurchaseRowNullable).filter(Boolean);
  }

  async function listPaymentMethodsForEntity(
    { billableEntityId, provider, includeInactive = false, limit = 20 },
    options = {}
  ) {
    const client = resolveClient(options);
    let query = client("billing_payment_methods")
      .where({
        billable_entity_id: billableEntityId,
        provider: normalizeProvider(provider)
      });

    if (!includeInactive) {
      query = query.andWhere({ status: "active" });
    }

    const rows = await query
      .orderBy("is_default", "desc")
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(200, Number(limit) || 20)));

    return rows.map(mapPaymentMethodRowNullable).filter(Boolean);
  }

  async function findPaymentMethodByProviderPaymentMethodId({ provider, providerPaymentMethodId }, options = {}) {
    const normalizedProviderPaymentMethodId = String(providerPaymentMethodId || "").trim();
    if (!normalizedProviderPaymentMethodId) {
      return null;
    }

    const client = resolveClient(options);
    const query = client("billing_payment_methods")
      .where({
        provider: normalizeProvider(provider),
        provider_payment_method_id: normalizedProviderPaymentMethodId
      })
      .first();

    const row = await applyForUpdate(query, options);
    return mapPaymentMethodRowNullable(row);
  }

  async function upsertPaymentMethod(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const provider = normalizeProvider(payload.provider);

    const insertPatch = {
      billable_entity_id: Number(payload.billableEntityId),
      billing_customer_id: Number(payload.billingCustomerId),
      provider,
      provider_payment_method_id: String(payload.providerPaymentMethodId || "").trim(),
      type: String(payload.type || "").trim() || "card",
      brand: payload.brand == null ? null : String(payload.brand || "").trim() || null,
      last4: payload.last4 == null ? null : String(payload.last4 || "").trim() || null,
      exp_month: payload.expMonth == null ? null : Number(payload.expMonth),
      exp_year: payload.expYear == null ? null : Number(payload.expYear),
      is_default: Boolean(payload.isDefault),
      status: String(payload.status || "").trim() || "active",
      last_provider_synced_at: toNullableDateTime(payload.lastProviderSyncedAt),
      metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
      created_at: toInsertDateTime(payload.createdAt, now),
      updated_at: toInsertDateTime(payload.updatedAt, now)
    };

    await client("billing_payment_methods")
      .insert(insertPatch)
      .onConflict(["provider", "provider_payment_method_id"])
      .merge({
        billable_entity_id: Number(payload.billableEntityId),
        billing_customer_id: Number(payload.billingCustomerId),
        type: insertPatch.type,
        brand: insertPatch.brand,
        last4: insertPatch.last4,
        exp_month: insertPatch.exp_month,
        exp_year: insertPatch.exp_year,
        is_default: insertPatch.is_default,
        status: insertPatch.status,
        last_provider_synced_at: insertPatch.last_provider_synced_at,
        metadata_json: insertPatch.metadata_json,
        updated_at: toInsertDateTime(payload.updatedAt, now)
      });

    const row = await client("billing_payment_methods")
      .where({
        provider,
        provider_payment_method_id: insertPatch.provider_payment_method_id
      })
      .first();

    return mapPaymentMethodRowNullable(row);
  }

  async function deactivateMissingPaymentMethods(
    { billableEntityId, provider, keepProviderPaymentMethodIds = [], now = new Date() },
    options = {}
  ) {
    const client = resolveClient(options);
    const normalizedProvider = normalizeProvider(provider);
    const keepIds = [...new Set((Array.isArray(keepProviderPaymentMethodIds) ? keepProviderPaymentMethodIds : [])
      .map((value) => String(value || "").trim())
      .filter((value) => value.length > 0))];

    let query = client("billing_payment_methods")
      .where({
        billable_entity_id: Number(billableEntityId),
        provider: normalizedProvider
      })
      .andWhereNot({ status: "detached" });

    if (keepIds.length > 0) {
      query = query.whereNotIn("provider_payment_method_id", keepIds);
    }

    const affectedRows = await query.update({
      status: "detached",
      is_default: false,
      last_provider_synced_at: toInsertDateTime(now, now),
      updated_at: toInsertDateTime(now, now)
    });

    return Number(affectedRows || 0);
  }

  async function insertPaymentMethodSyncEvent(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const normalizedBillableEntityId = toPositiveInteger(payload?.billableEntityId);
    const normalizedPayloadJson =
      payload?.payloadJson && typeof payload.payloadJson === "object"
        ? payload.payloadJson
        : null;
    const normalizedOperationKey =
      toNullableString(payload?.operationKey) ||
      toNullableString(normalizedPayloadJson?.operationKey) ||
      toNullableString(normalizedPayloadJson?.operation_key);
    const [id] = await client("billing_events").insert({
      event_type: "payment_method_sync",
      event_name: String(payload.eventType || "").trim() || "manual_sync",
      billable_entity_id: normalizedBillableEntityId,
      workspace_id: await resolveWorkspaceIdForBillableEntity(client, normalizedBillableEntityId),
      billing_customer_id: payload.billingCustomerId == null ? null : Number(payload.billingCustomerId),
      provider: normalizeProvider(payload.provider),
      provider_event_id: payload.providerEventId == null ? null : String(payload.providerEventId || "").trim() || null,
      operation_key: normalizedOperationKey,
      status: String(payload.status || "").trim() || "succeeded",
      error_text: payload.errorText == null ? null : String(payload.errorText),
      payload_json: normalizedPayloadJson == null ? null : JSON.stringify(normalizedPayloadJson),
      processed_at: toNullableDateTime(payload.processedAt || now),
      occurred_at: toInsertDateTime(payload.processedAt || now, now),
      created_at: toInsertDateTime(payload.createdAt, now),
      updated_at: toInsertDateTime(payload.updatedAt, now)
    });

    const row = await client("billing_events")
      .where({
        id,
        event_type: "payment_method_sync"
      })
      .first();
    return mapPaymentMethodSyncEventRowNullable(row);
  }

  async function listPaymentMethodSyncEventsForEntity({ billableEntityId, provider, limit = 20 }, options = {}) {
    const client = resolveClient(options);
    let query = client("billing_events").where({
      event_type: "payment_method_sync",
      billable_entity_id: Number(billableEntityId)
    });
    if (String(provider || "").trim()) {
      query = query.andWhere({ provider: normalizeProvider(provider) });
    }

    const rows = await query
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(200, Number(limit) || 20)));

    return rows.map(mapPaymentMethodSyncEventRowNullable).filter(Boolean);
  }

  async function findUsageCounter({ billableEntityId, entitlementCode, windowStartAt, windowEndAt }, options = {}) {
    void billableEntityId;
    void entitlementCode;
    void windowStartAt;
    void windowEndAt;
    void options;
    return null;
  }

  async function incrementUsageCounter(payload, options = {}) {
    void payload;
    void options;
    return null;
  }

  async function claimUsageEvent(payload, options = {}) {
    void payload;
    void options;
    return {
      claimed: true,
      event: null
    };
  }

  async function listUsageCountersForEntity({ billableEntityId, entitlementCode = null, limit = 200 }, options = {}) {
    void billableEntityId;
    void entitlementCode;
    void limit;
    void options;
    return [];
  }

  async function deleteUsageCountersOlderThan(cutoffDate, batchSize = 1000, options = {}) {
    void cutoffDate;
    void batchSize;
    void options;
    return 0;
  }

  async function listBillingActivityEvents(filters = {}, options = {}) {
    const client = resolveClient(options);

    const requestedLimit = Number(filters?.limit);
    const normalizedLimit =
      Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.floor(requestedLimit) : 100;
    const normalizedWorkspaceId = toPositiveInteger(filters?.workspaceId);
    const normalizedWorkspaceSlug = toNullableString(filters?.workspaceSlug);
    const normalizedOwnerUserId = toPositiveInteger(filters?.ownerUserId || filters?.userId);
    const normalizedBillableEntityId = toPositiveInteger(filters?.billableEntityId);
    const normalizedOperationKey = toNullableString(filters?.operationKey);
    const normalizedProviderEventId = toNullableString(filters?.providerEventId);
    const normalizedSource = String(filters?.source || "").trim().toLowerCase();
    const includeGlobal = filters?.includeGlobal !== false;
    const perSourceLimit = Math.max(50, normalizedLimit);

    const hasWorkspaceFilter = normalizedWorkspaceId != null || Boolean(normalizedWorkspaceSlug);
    const hasOwnerUserFilter = normalizedOwnerUserId != null;
    const hasBillableEntityFilter = normalizedBillableEntityId != null;
    const hasEntityScopedFilter = hasWorkspaceFilter || hasOwnerUserFilter || hasBillableEntityFilter;

    function includeSource(source) {
      if (!normalizedSource) {
        return true;
      }
      return normalizedSource === source;
    }

    function applyEntityFilters(query, billableEntityColumn, entityAlias = "be") {
      let scopedQuery = query;
      if (hasBillableEntityFilter) {
        scopedQuery = scopedQuery.andWhere(billableEntityColumn, normalizedBillableEntityId);
      }
      if (hasWorkspaceFilter) {
        if (normalizedWorkspaceId != null) {
          scopedQuery = scopedQuery.andWhere(`${entityAlias}.workspace_id`, normalizedWorkspaceId);
        }
        if (normalizedWorkspaceSlug) {
          scopedQuery = scopedQuery.andWhere("w.slug", normalizedWorkspaceSlug);
        }
      }
      if (hasOwnerUserFilter) {
        scopedQuery = scopedQuery.andWhere(`${entityAlias}.owner_user_id`, normalizedOwnerUserId);
      }
      return scopedQuery;
    }

    const rows = [];

    if (includeSource("idempotency")) {
      let query = client("billing_request_idempotency as bri")
        .join("billable_entities as be", "be.id", "bri.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["idempotency"]),
          "bri.id as source_id",
          "bri.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          "bri.provider",
          "bri.operation_key",
          client.raw("NULL as provider_event_id"),
          "bri.action as event_type",
          "bri.status",
          "bri.updated_at as occurred_at",
          "bri.failure_reason as message",
          "bri.response_json as details_json"
        );

      query = applyEntityFilters(query, "bri.billable_entity_id");
      if (normalizedOperationKey) {
        query = query.andWhere("bri.operation_key", normalizedOperationKey);
      }
      if (normalizedProviderEventId) {
        query = query.andWhereRaw("1 = 0");
      }

      query = query.orderBy("bri.updated_at", "desc").orderBy("bri.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }

    if (includeSource("checkout_session")) {
      let query = client("billing_checkout_sessions as bcs")
        .join("billable_entities as be", "be.id", "bcs.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["checkout_session"]),
          "bcs.id as source_id",
          "bcs.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          "bcs.provider",
          "bcs.operation_key",
          "bcs.last_provider_event_id as provider_event_id",
          client.raw("? as event_type", ["checkout_session"]),
          "bcs.status",
          "bcs.updated_at as occurred_at",
          client.raw("NULL as message"),
          "bcs.metadata_json as details_json"
        );

      query = applyEntityFilters(query, "bcs.billable_entity_id");
      if (normalizedOperationKey) {
        query = query.andWhere("bcs.operation_key", normalizedOperationKey);
      }
      if (normalizedProviderEventId) {
        query = query.andWhere("bcs.last_provider_event_id", normalizedProviderEventId);
      }

      query = query.orderBy("bcs.updated_at", "desc").orderBy("bcs.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }

    if (includeSource("subscription")) {
      let query = client("billing_plan_assignment_provider_details as bpad")
        .join("billing_plan_assignments as bpa", "bpa.id", "bpad.billing_plan_assignment_id")
        .join("billable_entities as be", "be.id", "bpa.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["subscription"]),
          "bpa.id as source_id",
          "bpa.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          "bpad.provider",
          client.raw("NULL as operation_key"),
          "bpad.last_provider_event_id as provider_event_id",
          client.raw("? as event_type", ["subscription"]),
          "bpad.provider_status as status",
          "bpad.updated_at as occurred_at",
          client.raw("NULL as message"),
          "bpad.metadata_json as details_json"
        );

      query = applyEntityFilters(query, "bpa.billable_entity_id");
      if (normalizedOperationKey) {
        query = query.andWhereRaw(
          "JSON_UNQUOTE(JSON_EXTRACT(bpad.metadata_json, '$.operation_key')) = ?",
          [normalizedOperationKey]
        );
      }
      if (normalizedProviderEventId) {
        query = query.andWhere("bpad.last_provider_event_id", normalizedProviderEventId);
      }

      query = query.orderBy("bpad.updated_at", "desc").orderBy("bpa.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }

    if (includeSource("payment_method_sync")) {
      let query = client("billing_events as bevt")
        .join("billable_entities as be", "be.id", "bevt.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["payment_method_sync"]),
          "bevt.id as source_id",
          "bevt.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          "bevt.provider",
          "bevt.operation_key",
          "bevt.provider_event_id",
          "bevt.event_name as event_type",
          "bevt.status",
          "bevt.updated_at as occurred_at",
          "bevt.error_text as message",
          "bevt.payload_json as details_json"
        );

      query = query.andWhere("bevt.event_type", "payment_method_sync");
      query = applyEntityFilters(query, "bevt.billable_entity_id");
      if (normalizedOperationKey) {
        query = query.andWhere((builder) => {
          builder
            .where("bevt.operation_key", normalizedOperationKey)
            .orWhereRaw(
              "JSON_UNQUOTE(JSON_EXTRACT(bevt.payload_json, '$.operation_key')) = ?",
              [normalizedOperationKey]
            );
        });
      }
      if (normalizedProviderEventId) {
        query = query.andWhere("bevt.provider_event_id", normalizedProviderEventId);
      }

      query = query.orderBy("bevt.updated_at", "desc").orderBy("bevt.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }

    if (includeSource("webhook")) {
      let query = client("billing_events as bevt")
        .leftJoin("billable_entities as be", "be.id", "bevt.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["webhook"]),
          "bevt.id as source_id",
          "bevt.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          "bevt.provider",
          "bevt.operation_key",
          "bevt.provider_event_id",
          "bevt.event_name as event_type",
          "bevt.status",
          "bevt.updated_at as occurred_at",
          "bevt.error_text as message",
          "bevt.payload_json as details_json"
        );

      query = query.andWhere("bevt.event_type", "webhook");
      query = applyEntityFilters(query, "bevt.billable_entity_id");
      if (!includeGlobal && !hasEntityScopedFilter) {
        query = query.whereNotNull("bevt.billable_entity_id");
      }
      if (normalizedProviderEventId) {
        query = query.andWhere("bevt.provider_event_id", normalizedProviderEventId);
      }
      if (normalizedOperationKey) {
        query = query.andWhere((builder) => {
          builder
            .where("bevt.operation_key", normalizedOperationKey)
            .orWhereRaw(
              "JSON_UNQUOTE(JSON_EXTRACT(bevt.payload_json, '$.data.object.metadata.operation_key')) = ?",
              [normalizedOperationKey]
            );
        });
      }

      query = query.orderBy("bevt.updated_at", "desc").orderBy("bevt.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }


    const normalizedRows = rows.map(mapBillingActivityRowNullable).filter(Boolean);
    normalizedRows.sort((left, right) => {
      const leftTime = new Date(left.occurredAt).getTime();
      const rightTime = new Date(right.occurredAt).getTime();
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      if (left.source === right.source) {
        return Number(right.sourceId || 0) - Number(left.sourceId || 0);
      }

      return String(left.source || "").localeCompare(String(right.source || ""));
    });

    return normalizedRows.slice(0, normalizedLimit);
  }

  async function findIdempotencyByEntityActionClientKey({ billableEntityId, action, clientIdempotencyKey }, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_request_idempotency")
      .where({ billable_entity_id: billableEntityId, action, client_idempotency_key: clientIdempotencyKey })
      .first();

    const row = await applyForUpdate(query, options);
    return mapIdempotencyRowNullable(row);
  }

  async function findIdempotencyById(id, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_request_idempotency").where({ id }).first();
    const row = await applyForUpdate(query, options);
    return mapIdempotencyRowNullable(row);
  }

  async function findCheckoutIdempotencyByOperationKey(operationKey, options = {}) {
    const normalizedOperationKey = String(operationKey || "").trim();
    if (!normalizedOperationKey) {
      return null;
    }

    const client = resolveClient(options);
    const query = client("billing_request_idempotency")
      .where({
        action: "checkout",
        operation_key: normalizedOperationKey
      })
      .first();

    const row = await applyForUpdate(query, options);
    return mapIdempotencyRowNullable(row);
  }

  async function findPendingCheckoutIdempotencyForEntity(billableEntityId, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_request_idempotency")
      .where({
        billable_entity_id: billableEntityId,
        action: "checkout",
        status: BILLING_IDEMPOTENCY_STATUS.PENDING
      })
      .orderBy("id", "desc")
      .first();

    const row = await applyForUpdate(query, options);
    return mapIdempotencyRowNullable(row);
  }

  async function listPendingIdempotencyRows(
    { action = null, staleBefore = null, limit = 100 } = {},
    options = {}
  ) {
    const client = resolveClient(options);
    let query = client("billing_request_idempotency").where({ status: BILLING_IDEMPOTENCY_STATUS.PENDING });
    const normalizedAction = String(action || "").trim();
    if (normalizedAction) {
      query = query.andWhere("action", normalizedAction);
    }

    if (staleBefore) {
      query = query.andWhere("pending_lease_expires_at", "<=", toInsertDateTime(staleBefore, staleBefore));
    }

    query = query
      .orderBy("pending_lease_expires_at", "asc")
      .orderBy("id", "asc")
      .limit(Math.max(1, Math.min(500, Number(limit) || 100)));

    query = applyForUpdate(query, options);
    const rows = await query;
    return rows.map(mapIdempotencyRowNullable).filter(Boolean);
  }

  async function deleteTerminalIdempotencyOlderThan(cutoffDate, batchSize = 1000, options = {}) {
    const cutoff = normalizeDateInput(cutoffDate);
    if (!cutoff) {
      return 0;
    }

    const client = resolveClient(options);
    const cappedBatchSize = Math.max(1, Math.min(10_000, Number(batchSize) || 1000));
    const ids = await client("billing_request_idempotency")
      .whereIn("status", [
        BILLING_IDEMPOTENCY_STATUS.SUCCEEDED,
        BILLING_IDEMPOTENCY_STATUS.FAILED,
        BILLING_IDEMPOTENCY_STATUS.EXPIRED
      ])
      .andWhere("updated_at", "<=", toInsertDateTime(cutoff, cutoff))
      .orderBy("id", "asc")
      .limit(cappedBatchSize)
      .pluck("id");

    if (!Array.isArray(ids) || ids.length < 1) {
      return 0;
    }

    const deleted = await client("billing_request_idempotency").whereIn("id", ids).delete();
    return Number(deleted || 0);
  }

  async function insertIdempotency(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);

    const [id] = await client("billing_request_idempotency").insert({
      billable_entity_id: payload.billableEntityId,
      action: payload.action,
      client_idempotency_key: payload.clientIdempotencyKey,
      request_fingerprint_hash: payload.requestFingerprintHash,
      normalized_request_json:
        payload.normalizedRequestJson == null ? JSON.stringify({}) : JSON.stringify(payload.normalizedRequestJson),
      operation_key: payload.operationKey,
      provider_request_params_json:
        payload.providerRequestParamsJson == null ? null : JSON.stringify(payload.providerRequestParamsJson),
      provider_request_hash: payload.providerRequestHash || null,
      provider_request_schema_version: payload.providerRequestSchemaVersion || null,
      provider_sdk_name: payload.providerSdkName || null,
      provider_sdk_version: payload.providerSdkVersion || null,
      provider_api_version: payload.providerApiVersion || null,
      provider_request_frozen_at: toNullableDateTime(payload.providerRequestFrozenAt),
      provider: normalizeProvider(payload.provider),
      provider_idempotency_key: payload.providerIdempotencyKey,
      provider_idempotency_replay_deadline_at: toNullableDateTime(payload.providerIdempotencyReplayDeadlineAt),
      provider_checkout_session_expires_at_upper_bound: toNullableDateTime(payload.providerCheckoutSessionExpiresAtUpperBound),
      provider_session_id: payload.providerSessionId || null,
      response_json: payload.responseJson == null ? null : JSON.stringify(payload.responseJson),
      status: payload.status,
      pending_lease_expires_at: toNullableDateTime(payload.pendingLeaseExpiresAt),
      pending_last_heartbeat_at: toNullableDateTime(payload.pendingLastHeartbeatAt),
      lease_owner: payload.leaseOwner || null,
      lease_version: Number(payload.leaseVersion || 1),
      recovery_attempt_count: Number(payload.recoveryAttemptCount || 0),
      last_recovery_attempt_at: toNullableDateTime(payload.lastRecoveryAttemptAt),
      failure_code: payload.failureCode || null,
      failure_reason: payload.failureReason || null,
      expires_at: toNullableDateTime(payload.expiresAt),
      created_at: toInsertDateTime(payload.createdAt, now),
      updated_at: toInsertDateTime(payload.updatedAt, now)
    });

    return findIdempotencyById(id, {
      ...options,
      trx: client
    });
  }

  async function updateIdempotencyById(id, patch, options = {}) {
    const client = resolveClient(options);
    const expectedLeaseVersion = Object.hasOwn(options, "expectedLeaseVersion")
      ? Number(options.expectedLeaseVersion)
      : null;
    const dbPatch = {};

    function setRaw(columnName, value) {
      const patchKey = resolvePatchPropertyName(columnName);
      if (!patchKey || !Object.hasOwn(patch, patchKey)) {
        return;
      }
      dbPatch[columnName] = value;
    }

    setRaw("request_fingerprint_hash", patch.requestFingerprintHash);
    setRaw(
      "normalized_request_json",
      Object.hasOwn(patch, "normalizedRequestJson")
        ? patch.normalizedRequestJson == null
          ? JSON.stringify({})
          : JSON.stringify(patch.normalizedRequestJson)
        : undefined
    );
    setRaw("operation_key", patch.operationKey);
    setRaw(
      "provider_request_params_json",
      Object.hasOwn(patch, "providerRequestParamsJson")
        ? patch.providerRequestParamsJson == null
          ? null
          : JSON.stringify(patch.providerRequestParamsJson)
        : undefined
    );
    setRaw("provider_request_hash", patch.providerRequestHash);
    setRaw("provider_request_schema_version", patch.providerRequestSchemaVersion);
    setRaw("provider_sdk_name", patch.providerSdkName);
    setRaw("provider_sdk_version", patch.providerSdkVersion);
    setRaw("provider_api_version", patch.providerApiVersion);
    setRaw("provider_request_frozen_at", toNullableDateTime(patch.providerRequestFrozenAt));
    setRaw("provider", Object.hasOwn(patch, "provider") ? normalizeProvider(patch.provider) : undefined);
    setRaw("provider_idempotency_key", patch.providerIdempotencyKey);
    setRaw("provider_idempotency_replay_deadline_at", toNullableDateTime(patch.providerIdempotencyReplayDeadlineAt));
    setRaw(
      "provider_checkout_session_expires_at_upper_bound",
      toNullableDateTime(patch.providerCheckoutSessionExpiresAtUpperBound)
    );
    setRaw("provider_session_id", patch.providerSessionId);
    setRaw(
      "response_json",
      Object.hasOwn(patch, "responseJson")
        ? patch.responseJson == null
          ? null
          : JSON.stringify(patch.responseJson)
        : undefined
    );
    setRaw("status", patch.status);
    setRaw("pending_lease_expires_at", toNullableDateTime(patch.pendingLeaseExpiresAt));
    setRaw("pending_last_heartbeat_at", toNullableDateTime(patch.pendingLastHeartbeatAt));
    setRaw("lease_owner", patch.leaseOwner);
    setRaw("lease_version", Object.hasOwn(patch, "leaseVersion") ? Number(patch.leaseVersion) : undefined);
    setRaw(
      "recovery_attempt_count",
      Object.hasOwn(patch, "recoveryAttemptCount") ? Number(patch.recoveryAttemptCount) : undefined
    );
    setRaw("last_recovery_attempt_at", toNullableDateTime(patch.lastRecoveryAttemptAt));
    setRaw("failure_code", patch.failureCode);
    setRaw("failure_reason", patch.failureReason);
    setRaw("expires_at", toNullableDateTime(patch.expiresAt));

    for (const key of Object.keys(dbPatch)) {
      if (dbPatch[key] === undefined) {
        delete dbPatch[key];
      }
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toInsertDateTime(new Date(), new Date());
      let updateQuery = client("billing_request_idempotency").where({ id });
      if (expectedLeaseVersion != null && Number.isInteger(expectedLeaseVersion)) {
        updateQuery = updateQuery.andWhere("lease_version", expectedLeaseVersion);
      }

      const affectedRows = await updateQuery.update(dbPatch);
      if (
        expectedLeaseVersion != null &&
        Number.isInteger(expectedLeaseVersion) &&
        Number(affectedRows || 0) < 1
      ) {
        return null;
      }
    }

    return findIdempotencyById(id, {
      ...options,
      trx: client
    });
  }

  async function lockCheckoutSessionsForEntity(billableEntityId, options = {}) {
    const client = resolveClient(options);
    let query = client("billing_checkout_sessions")
      .where({ billable_entity_id: billableEntityId })
      .orderBy("id", "asc");
    if (resolveQueryOptions(options).forUpdate && typeof query.forUpdate === "function") {
      query = query.forUpdate();
    }

    const rows = await query;
    return rows.map(mapCheckoutSessionRowNullable).filter(Boolean);
  }

  async function listCheckoutSessionsForEntity(billableEntityId, options = {}) {
    return lockCheckoutSessionsForEntity(billableEntityId, {
      ...options,
      forUpdate: false
    });
  }

  async function findCheckoutSessionByProviderOperationKey({ provider, operationKey }, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_checkout_sessions")
      .where({ provider: normalizeProvider(provider), operation_key: operationKey })
      .first();

    const row = await applyForUpdate(query, options);
    return mapCheckoutSessionRowNullable(row);
  }

  async function findCheckoutSessionByProviderSessionId({ provider, providerCheckoutSessionId }, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_checkout_sessions")
      .where({ provider: normalizeProvider(provider), provider_checkout_session_id: providerCheckoutSessionId })
      .first();

    const row = await applyForUpdate(query, options);
    return mapCheckoutSessionRowNullable(row);
  }

  async function findCheckoutSessionByProviderSubscriptionId({ provider, providerSubscriptionId }, options = {}) {
    const normalizedProviderSubscriptionId = String(providerSubscriptionId || "").trim();
    if (!normalizedProviderSubscriptionId) {
      return null;
    }

    const client = resolveClient(options);
    const query = client("billing_checkout_sessions")
      .where({
        provider: normalizeProvider(provider),
        provider_subscription_id: normalizedProviderSubscriptionId
      })
      .first();

    const row = await applyForUpdate(query, options);
    return mapCheckoutSessionRowNullable(row);
  }

  async function updateCheckoutSessionById(id, patch, options = {}) {
    const client = resolveClient(options);
    const dbPatch = {};

    function setIfPresent(key, value) {
      if (!Object.hasOwn(patch, key)) {
        return;
      }
      dbPatch[key] = value;
    }

    setIfPresent("provider_checkout_session_id", patch.providerCheckoutSessionId);
    setIfPresent("idempotency_row_id", patch.idempotencyRowId == null ? null : Number(patch.idempotencyRowId));
    setIfPresent("operation_key", patch.operationKey);
    setIfPresent("provider_customer_id", patch.providerCustomerId || null);
    setIfPresent("provider_subscription_id", patch.providerSubscriptionId || null);
    setIfPresent("status", patch.status);
    setIfPresent("checkout_url", patch.checkoutUrl || null);
    setIfPresent("expires_at", toNullableDateTime(patch.expiresAt));
    setIfPresent("completed_at", toNullableDateTime(patch.completedAt));
    setIfPresent("last_provider_event_created_at", toNullableDateTime(patch.lastProviderEventCreatedAt));
    setIfPresent("last_provider_event_id", patch.lastProviderEventId || null);
    setIfPresent(
      "metadata_json",
      Object.hasOwn(patch, "metadataJson")
        ? patch.metadataJson == null
          ? null
          : JSON.stringify(patch.metadataJson)
        : undefined
    );

    for (const key of Object.keys(dbPatch)) {
      if (dbPatch[key] === undefined) {
        delete dbPatch[key];
      }
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toInsertDateTime(new Date(), new Date());
      await client("billing_checkout_sessions").where({ id }).update(dbPatch);
    }

    const row = await client("billing_checkout_sessions").where({ id }).first();
    return mapCheckoutSessionRowNullable(row);
  }

  async function upsertCheckoutSessionByOperationKey(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const provider = normalizeProvider(payload.provider);

    await client("billing_checkout_sessions")
      .insert({
        billable_entity_id: payload.billableEntityId,
        provider,
        provider_checkout_session_id: payload.providerCheckoutSessionId || null,
        idempotency_row_id: payload.idempotencyRowId || null,
        operation_key: payload.operationKey,
        provider_customer_id: payload.providerCustomerId || null,
        provider_subscription_id: payload.providerSubscriptionId || null,
        status: payload.status,
        checkout_url: payload.checkoutUrl || null,
        expires_at: toNullableDateTime(payload.expiresAt),
        completed_at: toNullableDateTime(payload.completedAt),
        last_provider_event_created_at: toNullableDateTime(payload.lastProviderEventCreatedAt),
        last_provider_event_id: payload.lastProviderEventId || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        created_at: toInsertDateTime(payload.createdAt, now),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      })
      .onConflict(["provider", "operation_key"])
      .merge({
        billable_entity_id: payload.billableEntityId,
        provider_checkout_session_id: payload.providerCheckoutSessionId || null,
        idempotency_row_id: payload.idempotencyRowId || null,
        provider_customer_id: payload.providerCustomerId || null,
        provider_subscription_id: payload.providerSubscriptionId || null,
        status: payload.status,
        checkout_url: payload.checkoutUrl || null,
        expires_at: toNullableDateTime(payload.expiresAt),
        completed_at: toNullableDateTime(payload.completedAt),
        last_provider_event_created_at: toNullableDateTime(payload.lastProviderEventCreatedAt),
        last_provider_event_id: payload.lastProviderEventId || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      });

    return findCheckoutSessionByProviderOperationKey(
      {
        provider,
        operationKey: payload.operationKey
      },
      {
        ...options,
        trx: client
      }
    );
  }

  async function findWebhookEventByProviderEventId({ provider, providerEventId }, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_events")
      .where({
        event_type: "webhook",
        provider: normalizeProvider(provider),
        provider_event_id: providerEventId
      })
      .first();

    const row = await applyForUpdate(query, options);
    return mapWebhookEventRowNullable(row);
  }

  async function insertWebhookEvent(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const normalizedBillableEntityId = toPositiveInteger(payload.billableEntityId);

    const [id] = await client("billing_events").insert({
      event_type: "webhook",
      event_name: String(payload.eventType || "").trim(),
      provider: normalizeProvider(payload.provider),
      provider_event_id: payload.providerEventId,
      billable_entity_id: normalizedBillableEntityId,
      workspace_id: await resolveWorkspaceIdForBillableEntity(client, normalizedBillableEntityId),
      operation_key: toNullableString(payload.operationKey),
      provider_created_at: toInsertDateTime(payload.providerCreatedAt, now),
      status: payload.status || "received",
      received_at: toInsertDateTime(payload.receivedAt, now),
      processing_started_at: toNullableDateTime(payload.processingStartedAt),
      processed_at: toNullableDateTime(payload.processedAt),
      last_failed_at: toNullableDateTime(payload.lastFailedAt),
      attempt_count: Number(payload.attemptCount || 0),
      payload_json: payload.payloadJson == null ? JSON.stringify({}) : JSON.stringify(payload.payloadJson),
      payload_retention_until: toNullableDateTime(payload.payloadRetentionUntil),
      error_text: payload.errorText || null,
      occurred_at: toInsertDateTime(payload.providerCreatedAt || payload.receivedAt || now, now),
      created_at: toInsertDateTime(payload.createdAt, now),
      updated_at: toInsertDateTime(payload.updatedAt, now)
    });

    return findWebhookEventByProviderEventId(
      {
        provider: payload.provider,
        providerEventId: payload.providerEventId
      },
      {
        ...options,
        trx: client
      }
    ).then((existing) => existing || mapWebhookEventRowNullable({ id }));
  }

  async function updateWebhookEventById(id, patch, options = {}) {
    const client = resolveClient(options);
    const dbPatch = {};

    if (Object.hasOwn(patch, "status")) {
      dbPatch.status = patch.status;
    }
    if (Object.hasOwn(patch, "processingStartedAt")) {
      dbPatch.processing_started_at = toNullableDateTime(patch.processingStartedAt);
    }
    if (Object.hasOwn(patch, "processedAt")) {
      dbPatch.processed_at = toNullableDateTime(patch.processedAt);
    }
    if (Object.hasOwn(patch, "lastFailedAt")) {
      dbPatch.last_failed_at = toNullableDateTime(patch.lastFailedAt);
    }
    if (Object.hasOwn(patch, "attemptCount")) {
      dbPatch.attempt_count = Number(patch.attemptCount || 0);
    }
    if (Object.hasOwn(patch, "payloadRetentionUntil")) {
      dbPatch.payload_retention_until = toNullableDateTime(patch.payloadRetentionUntil);
    }
    if (Object.hasOwn(patch, "errorText")) {
      dbPatch.error_text = patch.errorText || null;
    }
    if (Object.hasOwn(patch, "billableEntityId")) {
      dbPatch.billable_entity_id = toPositiveInteger(patch.billableEntityId);
      dbPatch.workspace_id = await resolveWorkspaceIdForBillableEntity(client, dbPatch.billable_entity_id);
    }
    if (Object.hasOwn(patch, "operationKey")) {
      dbPatch.operation_key = toNullableString(patch.operationKey);
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toInsertDateTime(new Date(), new Date());
      await client("billing_events")
        .where({
          id,
          event_type: "webhook"
        })
        .update(dbPatch);
    }

    const row = await client("billing_events")
      .where({
        id,
        event_type: "webhook"
      })
      .first();
    return mapWebhookEventRowNullable(row);
  }

  async function listFailedWebhookEvents({ olderThan = null, limit = 200 }, options = {}) {
    const client = resolveClient(options);
    let query = client("billing_events").where({
      event_type: "webhook",
      status: "failed"
    });
    if (olderThan) {
      query = query.andWhere("updated_at", "<=", toInsertDateTime(olderThan, olderThan));
    }

    const rows = await query
      .orderBy("updated_at", "asc")
      .orderBy("id", "asc")
      .limit(Math.max(1, Math.min(1000, Number(limit) || 200)));

    return rows.map(mapWebhookEventRowNullable).filter(Boolean);
  }

  async function scrubWebhookPayloadsPastRetention({ now = new Date(), batchSize = 1000 } = {}, options = {}) {
    const client = resolveClient(options);
    const nowDate = normalizeDateInput(now) || new Date();
    const cappedBatchSize = Math.max(1, Math.min(10_000, Number(batchSize) || 1000));

    const rows = await client("billing_events")
      .where({ event_type: "webhook" })
      .whereNotNull("payload_retention_until")
      .andWhere("payload_retention_until", "<=", toInsertDateTime(nowDate, nowDate))
      .orderBy("payload_retention_until", "asc")
      .orderBy("id", "asc")
      .limit(cappedBatchSize)
      .select(["id"]);

    const ids = rows
      .map((row) => Number(row.id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (ids.length < 1) {
      return 0;
    }

    const updated = await client("billing_events").whereIn("id", ids).update({
      payload_json: JSON.stringify({}),
      payload_retention_until: null,
      updated_at: toInsertDateTime(nowDate, nowDate)
    });

    return Number(updated || 0);
  }

  async function enqueueOutboxJob(
    { jobType, dedupeKey, payloadJson, availableAt, billableEntityId, operationKey, providerEventId },
    options = {}
  ) {
    void jobType;
    void dedupeKey;
    void payloadJson;
    void availableAt;
    void billableEntityId;
    void operationKey;
    void providerEventId;
    void options;
    return null;
  }

  async function upsertSubscriptionRemediation(payload, options = {}) {
    void payload;
    void options;
    return null;
  }

  async function leaseNextOutboxJob({ workerId, now = new Date(), leaseSeconds = 60 }, options = {}) {
    void workerId;
    void now;
    void leaseSeconds;
    void options;
    return null;
  }

  async function updateOutboxJobByLease({ id, leaseVersion, patch }, options = {}) {
    void id;
    void leaseVersion;
    void patch;
    void options;
    return null;
  }

  async function leaseNextRemediation({ workerId, now = new Date(), leaseSeconds = 60 }, options = {}) {
    void workerId;
    void now;
    void leaseSeconds;
    void options;
    return null;
  }

  async function updateRemediationByLease({ id, leaseVersion, patch }, options = {}) {
    void id;
    void leaseVersion;
    void patch;
    void options;
    return null;
  }

  async function acquireReconciliationRun({ provider, scope, runnerId, now = new Date(), leaseSeconds = 120 }, options = {}) {
    void provider;
    void scope;
    void runnerId;
    void now;
    void leaseSeconds;
    void options;
    return {
      acquired: false,
      run: null
    };
  }

  async function updateReconciliationRunByLease({ id, leaseVersion, patch }, options = {}) {
    void id;
    void leaseVersion;
    void patch;
    void options;
    return null;
  }

  async function listReconciliationCheckoutSessions(
    { status, olderThan, olderThanColumn = "updated_at", includeNullOlderThan = false, limit = 100 },
    options = {}
  ) {
    const client = resolveClient(options);
    const normalizedStatus = String(status || "").trim();
    let query = client("billing_checkout_sessions").where({ status: normalizedStatus });

    const normalizedOlderThanColumn = String(olderThanColumn || "updated_at").trim().toLowerCase();
    const safeOlderThanColumns = new Set(["updated_at", "expires_at", "completed_at", "created_at"]);
    const comparisonColumn = safeOlderThanColumns.has(normalizedOlderThanColumn)
      ? normalizedOlderThanColumn
      : "updated_at";

    if (olderThan) {
      const olderThanDate = toInsertDateTime(olderThan, olderThan);
      if (includeNullOlderThan) {
        query = query.andWhere((builder) => {
          builder.whereNull(comparisonColumn).orWhere(comparisonColumn, "<=", olderThanDate);
        });
      } else {
        query = query.andWhere(comparisonColumn, "<=", olderThanDate);
      }
    }

    const rows = await query
      .orderBy(comparisonColumn, "asc")
      .orderBy("updated_at", "asc")
      .orderBy("id", "asc")
      .limit(Math.max(1, Math.min(500, Number(limit) || 100)));
    return rows.map(mapCheckoutSessionRowNullable).filter(Boolean);
  }

  return {
    transaction,
    findBillableEntityById,
    findBillableEntityByWorkspaceId,
    findBillableEntityByTypeRef,
    ensureBillableEntity,
    ensureBillableEntityByScope,
    listPlans,
    findPlanByCode,
    findPlanById,
    findPlanByCheckoutProviderPriceId,
    listProducts,
    findProductByCode,
    findProductById,
    createProduct,
    updateProductById,
    listPlanEntitlementsForPlan,
    createPlan,
    updatePlanById,
    upsertPlanEntitlement,
    findPlanAssignmentById,
    findCurrentPlanAssignmentForEntity,
    findUpcomingPlanAssignmentForEntity,
    listPlanAssignmentsForEntity,
    updatePlanAssignmentById,
    clearCurrentPlanAssignmentsForEntity,
    cancelUpcomingPlanAssignmentForEntity,
    replaceUpcomingPlanAssignmentForEntity,
    listDueUpcomingPlanAssignments,
    insertPlanAssignment,
    insertPlanChangeHistory,
    listPlanChangeHistoryForEntity,
    findCustomerById,
    findCustomerByEntityProvider,
    findCustomerByProviderCustomerId,
    upsertCustomer,
    findPlanAssignmentProviderDetailsByAssignmentId,
    upsertPlanAssignmentProviderDetails,
    findPlanAssignmentByProviderSubscriptionId,
    findCurrentSubscriptionForEntity,
    lockSubscriptionsForEntity,
    findSubscriptionByProviderSubscriptionId,
    listCurrentSubscriptions,
    findSubscriptionItemByProviderSubscriptionItemId,
    clearCurrentSubscriptionFlagsForEntity,
    upsertSubscription,
    listSubscriptionItemsForSubscription,
    upsertSubscriptionItem,
    findInvoiceByProviderInvoiceId,
    listInvoicesForSubscription,
    listRecentInvoices,
    upsertInvoice,
    findPaymentByProviderPaymentId,
    listPaymentsForInvoiceIds,
    upsertPayment,
    upsertBillingPurchase,
    listBillingPurchasesForEntity,
    listPaymentMethodsForEntity,
    findPaymentMethodByProviderPaymentMethodId,
    upsertPaymentMethod,
    deactivateMissingPaymentMethods,
    insertPaymentMethodSyncEvent,
    listPaymentMethodSyncEventsForEntity,
    findUsageCounter,
    incrementUsageCounter,
    listUsageCountersForEntity,
    deleteUsageCountersOlderThan,
    claimUsageEvent,
    listBillingActivityEvents,
    findIdempotencyByEntityActionClientKey,
    findIdempotencyById,
    findCheckoutIdempotencyByOperationKey,
    findPendingCheckoutIdempotencyForEntity,
    listPendingIdempotencyRows,
    deleteTerminalIdempotencyOlderThan,
    insertIdempotency,
    updateIdempotencyById,
    lockCheckoutSessionsForEntity,
    listCheckoutSessionsForEntity,
    findCheckoutSessionByProviderOperationKey,
    findCheckoutSessionByProviderSessionId,
    findCheckoutSessionByProviderSubscriptionId,
    updateCheckoutSessionById,
    upsertCheckoutSessionByOperationKey,
    findWebhookEventByProviderEventId,
    insertWebhookEvent,
    updateWebhookEventById,
    listFailedWebhookEvents,
    scrubWebhookPayloadsPastRetention,
    enqueueOutboxJob,
    upsertSubscriptionRemediation,
    leaseNextOutboxJob,
    updateOutboxJobByLease,
    leaseNextRemediation,
    updateRemediationByLease,
    acquireReconciliationRun,
    updateReconciliationRunByLease,
    listReconciliationCheckoutSessions
  };
}

const repository = createBillingRepository(db);

const __testables = {
  parseJsonValue,
  normalizeProvider,
  resolvePatchPropertyName,
  normalizeBillableEntityType,
  mapBillableEntityRowNullable,
  mapPlanRowNullable,
  mapProductRowNullable,
  mapEntitlementRowNullable,
  mapCustomerRowNullable,
  mapSubscriptionRowNullable,
  mapSubscriptionItemRowNullable,
  mapInvoiceRowNullable,
  mapPaymentRowNullable,
  mapPaymentMethodRowNullable,
  mapPaymentMethodSyncEventRowNullable,
  mapUsageCounterRowNullable,
  mapUsageEventRowNullable,
  mapBillingActivityRowNullable,
  mapIdempotencyRowNullable,
  mapCheckoutSessionRowNullable,
  mapWebhookEventRowNullable,
  mapOutboxJobRowNullable,
  mapRemediationRowNullable,
  mapReconciliationRunRowNullable,
  mapPlanAssignmentRowNullable,
  mapPlanAssignmentProviderDetailsRowNullable,
  mapPlanChangeHistoryRowNullable,
  mapBillingPurchaseRowNullable,
  toInsertDateTime,
  toNullableDateTime,
  createBillingRepository
};

export const {
  transaction,
  findBillableEntityById,
  findBillableEntityByWorkspaceId,
  findBillableEntityByTypeRef,
  ensureBillableEntity,
  ensureBillableEntityByScope,
  listPlans,
  findPlanByCode,
  findPlanById,
  findPlanByCheckoutProviderPriceId,
  listProducts,
  findProductByCode,
  findProductById,
  createProduct,
  updateProductById,
  listPlanEntitlementsForPlan,
  createPlan,
  updatePlanById,
  upsertPlanEntitlement,
  findPlanAssignmentById,
  findCurrentPlanAssignmentForEntity,
  findUpcomingPlanAssignmentForEntity,
  listPlanAssignmentsForEntity,
  updatePlanAssignmentById,
  clearCurrentPlanAssignmentsForEntity,
  cancelUpcomingPlanAssignmentForEntity,
  replaceUpcomingPlanAssignmentForEntity,
  listDueUpcomingPlanAssignments,
  insertPlanAssignment,
  insertPlanChangeHistory,
  listPlanChangeHistoryForEntity,
  findCustomerById,
  findCustomerByEntityProvider,
  findCustomerByProviderCustomerId,
  upsertCustomer,
  findPlanAssignmentProviderDetailsByAssignmentId,
  upsertPlanAssignmentProviderDetails,
  findPlanAssignmentByProviderSubscriptionId,
  findCurrentSubscriptionForEntity,
  lockSubscriptionsForEntity,
  findSubscriptionByProviderSubscriptionId,
  listCurrentSubscriptions,
  findSubscriptionItemByProviderSubscriptionItemId,
  clearCurrentSubscriptionFlagsForEntity,
  upsertSubscription,
  listSubscriptionItemsForSubscription,
  upsertSubscriptionItem,
  findInvoiceByProviderInvoiceId,
  listInvoicesForSubscription,
  listRecentInvoices,
  upsertInvoice,
  findPaymentByProviderPaymentId,
  listPaymentsForInvoiceIds,
  upsertPayment,
  upsertBillingPurchase,
  listBillingPurchasesForEntity,
  listPaymentMethodsForEntity,
  findPaymentMethodByProviderPaymentMethodId,
  upsertPaymentMethod,
  deactivateMissingPaymentMethods,
  insertPaymentMethodSyncEvent,
  listPaymentMethodSyncEventsForEntity,
  findUsageCounter,
  incrementUsageCounter,
  listUsageCountersForEntity,
  deleteUsageCountersOlderThan,
  claimUsageEvent,
  listBillingActivityEvents,
  findIdempotencyByEntityActionClientKey,
  findIdempotencyById,
  findCheckoutIdempotencyByOperationKey,
  findPendingCheckoutIdempotencyForEntity,
  listPendingIdempotencyRows,
  deleteTerminalIdempotencyOlderThan,
  insertIdempotency,
  updateIdempotencyById,
  lockCheckoutSessionsForEntity,
  listCheckoutSessionsForEntity,
  findCheckoutSessionByProviderOperationKey,
  findCheckoutSessionByProviderSessionId,
  findCheckoutSessionByProviderSubscriptionId,
  updateCheckoutSessionById,
  upsertCheckoutSessionByOperationKey,
  findWebhookEventByProviderEventId,
  insertWebhookEvent,
  updateWebhookEventById,
  listFailedWebhookEvents,
  scrubWebhookPayloadsPastRetention,
  enqueueOutboxJob,
  upsertSubscriptionRemediation,
  leaseNextOutboxJob,
  updateOutboxJobByLease,
  leaseNextRemediation,
  updateRemediationByLease,
  acquireReconciliationRun,
  updateReconciliationRunByLease,
  listReconciliationCheckoutSessions
} = repository;

export { __testables };
