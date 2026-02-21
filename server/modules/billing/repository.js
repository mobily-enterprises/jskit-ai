import { db } from "../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../lib/primitives/dateUtils.js";
import { isMysqlDuplicateEntryError } from "../../lib/primitives/mysqlErrors.js";
import {
  BILLING_CHECKOUT_SESSION_STATUS,
  BILLING_IDEMPOTENCY_STATUS,
  BILLING_PROVIDER_STRIPE,
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
  return normalized || BILLING_PROVIDER_STRIPE;
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
    planFamilyCode: String(row.plan_family_code || ""),
    version: Number(row.version),
    name: String(row.name || ""),
    description: row.description == null ? null : String(row.description),
    appliesTo: String(row.applies_to || "workspace"),
    pricingModel: String(row.pricing_model || "flat"),
    isActive: Boolean(row.is_active),
    metadataJson: parseJsonValue(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapPlanPriceRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    planId: Number(row.plan_id),
    provider: normalizeProvider(row.provider),
    billingComponent: String(row.billing_component || "base"),
    usageType: String(row.usage_type || "licensed"),
    interval: String(row.interval || "month"),
    intervalCount: Number(row.interval_count || 1),
    currency: String(row.currency || "").toUpperCase(),
    unitAmountMinor: Number(row.unit_amount_minor || 0),
    providerProductId: row.provider_product_id == null ? null : String(row.provider_product_id),
    providerPriceId: String(row.provider_price_id || ""),
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
    billingCustomerId: Number(row.billing_customer_id),
    provider: normalizeProvider(row.provider),
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

  return {
    id: Number(row.id),
    billableEntityId: Number(row.billable_entity_id),
    billingCustomerId: row.billing_customer_id == null ? null : Number(row.billing_customer_id),
    provider: normalizeProvider(row.provider),
    eventType: String(row.event_type || "manual_sync"),
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

  return {
    id: Number(row.id),
    billableEntityId: row.billable_entity_id == null ? null : Number(row.billable_entity_id),
    provider: normalizeProvider(row.provider),
    providerEventId: String(row.provider_event_id || ""),
    operationKey: toNullableString(row.operation_key),
    eventType: String(row.event_type || ""),
    providerCreatedAt: toIsoString(row.provider_created_at),
    status: String(row.status || "received"),
    receivedAt: toIsoString(row.received_at),
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

  async function listPlanPricesForPlan(planId, provider, options = {}) {
    const client = resolveClient(options);
    const rows = await client("billing_plan_prices")
      .where({ plan_id: planId, provider: normalizeProvider(provider) })
      .orderBy("is_active", "desc")
      .orderBy("id", "asc");

    return rows.map(mapPlanPriceRowNullable).filter(Boolean);
  }

  async function findPlanPriceByProviderPriceId({ provider, providerPriceId }, options = {}) {
    const normalizedProvider = normalizeProvider(provider);
    const normalizedProviderPriceId = String(providerPriceId || "").trim();
    if (!normalizedProviderPriceId) {
      return null;
    }

    const client = resolveClient(options);
    const query = client("billing_plan_prices")
      .where({
        provider: normalizedProvider,
        provider_price_id: normalizedProviderPriceId
      })
      .first();

    const row = await applyForUpdate(query, options);
    return mapPlanPriceRowNullable(row);
  }

  async function findSellablePlanPricesForPlan({ planId, provider, currency }, options = {}) {
    const normalizedCurrency = String(currency || "").trim().toUpperCase();
    const client = resolveClient(options);
    const rows = await client("billing_plan_prices")
      .where({
        plan_id: planId,
        provider: normalizeProvider(provider),
        is_active: true,
        usage_type: "licensed",
        billing_component: "base"
      })
      .andWhere("currency", normalizedCurrency)
      .orderBy("id", "asc");

    return rows.map(mapPlanPriceRowNullable).filter(Boolean);
  }

  async function listPlanEntitlementsForPlan(planId, options = {}) {
    const client = resolveClient(options);
    const rows = await client("billing_entitlements").where({ plan_id: planId }).orderBy("id", "asc");
    return rows.map(mapEntitlementRowNullable).filter(Boolean);
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

  async function findCurrentSubscriptionForEntity(billableEntityId, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_subscriptions")
      .where({ billable_entity_id: billableEntityId, is_current: true })
      .orderBy("id", "asc")
      .first();

    const row = await applyForUpdate(query, options);
    return mapSubscriptionRowNullable(row);
  }

  async function lockSubscriptionsForEntity(billableEntityId, options = {}) {
    const client = resolveClient(options);
    let query = client("billing_subscriptions").where({ billable_entity_id: billableEntityId }).orderBy("id", "asc");
    if (resolveQueryOptions(options).forUpdate && typeof query.forUpdate === "function") {
      query = query.forUpdate();
    }

    const rows = await query;
    return rows.map(mapSubscriptionRowNullable).filter(Boolean);
  }

  async function findSubscriptionByProviderSubscriptionId({ provider, providerSubscriptionId }, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_subscriptions")
      .where({ provider: normalizeProvider(provider), provider_subscription_id: providerSubscriptionId })
      .first();

    const row = await applyForUpdate(query, options);
    return mapSubscriptionRowNullable(row);
  }

  async function listCurrentSubscriptions({ provider, limit = 200 }, options = {}) {
    const client = resolveClient(options);
    const rows = await client("billing_subscriptions")
      .where({
        provider: normalizeProvider(provider),
        is_current: true
      })
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(1000, Number(limit) || 200)));

    return rows.map(mapSubscriptionRowNullable).filter(Boolean);
  }

  async function clearCurrentSubscriptionFlagsForEntity(billableEntityId, options = {}) {
    const client = resolveClient(options);
    await client("billing_subscriptions")
      .where({ billable_entity_id: billableEntityId, is_current: true })
      .update({
        is_current: false,
        updated_at: toInsertDateTime(new Date(), new Date())
      });
  }

  async function upsertSubscription(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const provider = normalizeProvider(payload.provider);
    const status = String(payload.status || BILLING_SUBSCRIPTION_STATUS.INCOMPLETE).trim();
    const isCurrentCandidate = Boolean(payload.isCurrent);
    const isCurrentAllowed = NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET.has(status);
    const isCurrent = isCurrentCandidate && isCurrentAllowed;

    if (isCurrent) {
      await clearCurrentSubscriptionFlagsForEntity(payload.billableEntityId, {
        ...options,
        trx: client
      });
    }

    const patch = {
      billable_entity_id: payload.billableEntityId,
      plan_id: payload.planId,
      billing_customer_id: payload.billingCustomerId,
      status,
      current_period_end: toNullableDateTime(payload.currentPeriodEnd),
      trial_end: toNullableDateTime(payload.trialEnd),
      canceled_at: toNullableDateTime(payload.canceledAt),
      cancel_at_period_end: Boolean(payload.cancelAtPeriodEnd),
      ended_at: toNullableDateTime(payload.endedAt),
      is_current: isCurrent,
      last_provider_event_created_at: toNullableDateTime(payload.lastProviderEventCreatedAt),
      last_provider_event_id: payload.lastProviderEventId || null,
      metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
      updated_at: toInsertDateTime(payload.updatedAt, now)
    };

    await client("billing_subscriptions")
      .insert({
        ...patch,
        provider,
        provider_subscription_id: payload.providerSubscriptionId,
        provider_subscription_created_at: toInsertDateTime(payload.providerSubscriptionCreatedAt, now),
        created_at: toInsertDateTime(payload.createdAt, now)
      })
      .onConflict(["provider", "provider_subscription_id"])
      .merge(patch);

    const row = await client("billing_subscriptions")
      .where({ provider, provider_subscription_id: payload.providerSubscriptionId })
      .first();

    const mapped = mapSubscriptionRowNullable(row);
    if (!mapped) {
      return null;
    }

    if (TERMINAL_SUBSCRIPTION_STATUS_SET.has(mapped.status) && mapped.isCurrent) {
      await client("billing_subscriptions")
        .where({ id: mapped.id })
        .update({
          is_current: false,
          updated_at: toInsertDateTime(new Date(), new Date())
        });
      return findSubscriptionByProviderSubscriptionId(
        {
          provider,
          providerSubscriptionId: payload.providerSubscriptionId
        },
        {
          ...options,
          trx: client
        }
      );
    }

    return mapped;
  }

  async function listSubscriptionItemsForSubscription({ subscriptionId, provider }, options = {}) {
    const client = resolveClient(options);
    const rows = await client("billing_subscription_items")
      .where({ subscription_id: subscriptionId, provider: normalizeProvider(provider) })
      .orderBy("id", "asc");

    return rows.map(mapSubscriptionItemRowNullable).filter(Boolean);
  }

  async function findSubscriptionItemByProviderSubscriptionItemId(
    { provider, providerSubscriptionItemId },
    options = {}
  ) {
    const normalizedProviderSubscriptionItemId = String(providerSubscriptionItemId || "").trim();
    if (!normalizedProviderSubscriptionItemId) {
      return null;
    }

    const client = resolveClient(options);
    const query = client("billing_subscription_items")
      .where({
        provider: normalizeProvider(provider),
        provider_subscription_item_id: normalizedProviderSubscriptionItemId
      })
      .first();
    const row = await applyForUpdate(query, options);
    return mapSubscriptionItemRowNullable(row);
  }

  async function upsertSubscriptionItem(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const provider = normalizeProvider(payload.provider);

    await client("billing_subscription_items")
      .insert({
        subscription_id: payload.subscriptionId,
        provider,
        provider_subscription_item_id: payload.providerSubscriptionItemId,
        billing_plan_price_id: payload.billingPlanPriceId || null,
        billing_component: payload.billingComponent,
        usage_type: payload.usageType,
        quantity: payload.quantity == null ? null : Number(payload.quantity),
        is_active: Boolean(payload.isActive),
        last_provider_event_created_at: toNullableDateTime(payload.lastProviderEventCreatedAt),
        last_provider_event_id: payload.lastProviderEventId || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        created_at: toInsertDateTime(payload.createdAt, now),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      })
      .onConflict(["provider", "provider_subscription_item_id"])
      .merge({
        subscription_id: payload.subscriptionId,
        billing_plan_price_id: payload.billingPlanPriceId || null,
        billing_component: payload.billingComponent,
        usage_type: payload.usageType,
        quantity: payload.quantity == null ? null : Number(payload.quantity),
        is_active: Boolean(payload.isActive),
        last_provider_event_created_at: toNullableDateTime(payload.lastProviderEventCreatedAt),
        last_provider_event_id: payload.lastProviderEventId || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      });

    const row = await client("billing_subscription_items")
      .where({ provider, provider_subscription_item_id: payload.providerSubscriptionItemId })
      .first();

    return mapSubscriptionItemRowNullable(row);
  }

  async function listInvoicesForSubscription({ subscriptionId, provider, limit = 20 }, options = {}) {
    const client = resolveClient(options);
    const rows = await client("billing_invoices")
      .where({ subscription_id: subscriptionId, provider: normalizeProvider(provider) })
      .orderBy("issued_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(100, Number(limit) || 20)));

    return rows.map(mapInvoiceRowNullable).filter(Boolean);
  }

  async function listRecentInvoices({ provider, since = null, limit = 200 }, options = {}) {
    const client = resolveClient(options);
    let query = client("billing_invoices").where({ provider: normalizeProvider(provider) });
    if (since) {
      query = query.andWhere("updated_at", ">=", toInsertDateTime(since, since));
    }

    const rows = await query
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(1000, Number(limit) || 200)));

    return rows.map(mapInvoiceRowNullable).filter(Boolean);
  }

  async function findInvoiceByProviderInvoiceId({ provider, providerInvoiceId }, options = {}) {
    const normalizedProviderInvoiceId = String(providerInvoiceId || "").trim();
    if (!normalizedProviderInvoiceId) {
      return null;
    }

    const client = resolveClient(options);
    const query = client("billing_invoices")
      .where({
        provider: normalizeProvider(provider),
        provider_invoice_id: normalizedProviderInvoiceId
      })
      .first();

    const row = await applyForUpdate(query, options);
    return mapInvoiceRowNullable(row);
  }

  async function upsertInvoice(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const provider = normalizeProvider(payload.provider);

    await client("billing_invoices")
      .insert({
        subscription_id: payload.subscriptionId == null ? null : Number(payload.subscriptionId),
        billable_entity_id: payload.billableEntityId,
        billing_customer_id: payload.billingCustomerId,
        provider,
        provider_invoice_id: payload.providerInvoiceId,
        status: payload.status,
        amount_due_minor: Number(payload.amountDueMinor || 0),
        amount_paid_minor: Number(payload.amountPaidMinor || 0),
        amount_remaining_minor: Number(payload.amountRemainingMinor || 0),
        currency: String(payload.currency || "").toUpperCase(),
        issued_at: toNullableDateTime(payload.issuedAt),
        due_at: toNullableDateTime(payload.dueAt),
        paid_at: toNullableDateTime(payload.paidAt),
        last_provider_event_created_at: toNullableDateTime(payload.lastProviderEventCreatedAt),
        last_provider_event_id: payload.lastProviderEventId || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        created_at: toInsertDateTime(payload.createdAt, now),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      })
      .onConflict(["provider", "provider_invoice_id"])
      .merge({
        subscription_id: payload.subscriptionId == null ? null : Number(payload.subscriptionId),
        billable_entity_id: payload.billableEntityId,
        billing_customer_id: payload.billingCustomerId,
        status: payload.status,
        amount_due_minor: Number(payload.amountDueMinor || 0),
        amount_paid_minor: Number(payload.amountPaidMinor || 0),
        amount_remaining_minor: Number(payload.amountRemainingMinor || 0),
        currency: String(payload.currency || "").toUpperCase(),
        issued_at: toNullableDateTime(payload.issuedAt),
        due_at: toNullableDateTime(payload.dueAt),
        paid_at: toNullableDateTime(payload.paidAt),
        last_provider_event_created_at: toNullableDateTime(payload.lastProviderEventCreatedAt),
        last_provider_event_id: payload.lastProviderEventId || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      });

    const row = await client("billing_invoices")
      .where({ provider, provider_invoice_id: payload.providerInvoiceId })
      .first();

    return mapInvoiceRowNullable(row);
  }

  async function listPaymentsForInvoiceIds({ provider, invoiceIds }, options = {}) {
    const normalizedInvoiceIds = (Array.isArray(invoiceIds) ? invoiceIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (normalizedInvoiceIds.length < 1) {
      return [];
    }

    const client = resolveClient(options);
    const rows = await client("billing_payments")
      .where({ provider: normalizeProvider(provider) })
      .whereIn("invoice_id", normalizedInvoiceIds)
      .orderBy("id", "desc");

    return rows.map(mapPaymentRowNullable).filter(Boolean);
  }

  async function findPaymentByProviderPaymentId({ provider, providerPaymentId }, options = {}) {
    const normalizedProviderPaymentId = String(providerPaymentId || "").trim();
    if (!normalizedProviderPaymentId) {
      return null;
    }

    const client = resolveClient(options);
    const query = client("billing_payments")
      .where({
        provider: normalizeProvider(provider),
        provider_payment_id: normalizedProviderPaymentId
      })
      .first();

    const row = await applyForUpdate(query, options);
    return mapPaymentRowNullable(row);
  }

  async function upsertPayment(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);
    const provider = normalizeProvider(payload.provider);

    await client("billing_payments")
      .insert({
        invoice_id: payload.invoiceId,
        provider,
        provider_payment_id: payload.providerPaymentId,
        type: payload.type,
        status: payload.status,
        amount_minor: Number(payload.amountMinor || 0),
        currency: String(payload.currency || "").toUpperCase(),
        paid_at: toNullableDateTime(payload.paidAt),
        last_provider_event_created_at: toNullableDateTime(payload.lastProviderEventCreatedAt),
        last_provider_event_id: payload.lastProviderEventId || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        created_at: toInsertDateTime(payload.createdAt, now),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      })
      .onConflict(["provider", "provider_payment_id"])
      .merge({
        invoice_id: payload.invoiceId,
        type: payload.type,
        status: payload.status,
        amount_minor: Number(payload.amountMinor || 0),
        currency: String(payload.currency || "").toUpperCase(),
        paid_at: toNullableDateTime(payload.paidAt),
        last_provider_event_created_at: toNullableDateTime(payload.lastProviderEventCreatedAt),
        last_provider_event_id: payload.lastProviderEventId || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      });

    const row = await client("billing_payments")
      .where({ provider, provider_payment_id: payload.providerPaymentId })
      .first();

    return mapPaymentRowNullable(row);
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
    const [id] = await client("billing_payment_method_sync_events").insert({
      billable_entity_id: Number(payload.billableEntityId),
      billing_customer_id: payload.billingCustomerId == null ? null : Number(payload.billingCustomerId),
      provider: normalizeProvider(payload.provider),
      event_type: String(payload.eventType || "").trim() || "manual_sync",
      provider_event_id: payload.providerEventId == null ? null : String(payload.providerEventId || "").trim() || null,
      status: String(payload.status || "").trim() || "succeeded",
      error_text: payload.errorText == null ? null : String(payload.errorText),
      payload_json: payload.payloadJson == null ? null : JSON.stringify(payload.payloadJson),
      processed_at: toNullableDateTime(payload.processedAt || now),
      created_at: toInsertDateTime(payload.createdAt, now),
      updated_at: toInsertDateTime(payload.updatedAt, now)
    });

    const row = await client("billing_payment_method_sync_events").where({ id }).first();
    return mapPaymentMethodSyncEventRowNullable(row);
  }

  async function listPaymentMethodSyncEventsForEntity({ billableEntityId, provider, limit = 20 }, options = {}) {
    const client = resolveClient(options);
    let query = client("billing_payment_method_sync_events").where({ billable_entity_id: Number(billableEntityId) });
    if (String(provider || "").trim()) {
      query = query.andWhere({ provider: normalizeProvider(provider) });
    }

    const rows = await query
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(200, Number(limit) || 20)));

    return rows.map(mapPaymentMethodSyncEventRowNullable).filter(Boolean);
  }

  async function findUsageCounter({ billableEntityId, entitlementCode, windowStartAt, windowEndAt }, options = {}) {
    const client = resolveClient(options);
    const query = client("billing_usage_counters")
      .where({
        billable_entity_id: Number(billableEntityId),
        entitlement_code: String(entitlementCode || "").trim(),
        window_start_at: toInsertDateTime(windowStartAt, windowStartAt),
        window_end_at: toInsertDateTime(windowEndAt, windowEndAt)
      })
      .first();
    const row = await applyForUpdate(query, options);
    return mapUsageCounterRowNullable(row);
  }

  async function incrementUsageCounter(payload, options = {}) {
    const client = resolveClient(options);
    const now = new Date();
    const amount = Number(payload.amount);
    const normalizedAmount = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
    if (normalizedAmount < 1) {
      return findUsageCounter(payload, options);
    }

    const billableEntityId = Number(payload.billableEntityId);
    const entitlementCode = String(payload.entitlementCode || "").trim();
    const windowStartAt = toInsertDateTime(payload.windowStartAt, payload.windowStartAt);
    const windowEndAt = toInsertDateTime(payload.windowEndAt, payload.windowEndAt);

    const mergePatch = {
      usage_count: client.raw("usage_count + ?", [normalizedAmount]),
      updated_at: toInsertDateTime(payload.updatedAt, now)
    };
    if (Object.prototype.hasOwnProperty.call(payload, "metadataJson")) {
      mergePatch.metadata_json = payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson);
    }

    await client("billing_usage_counters")
      .insert({
        billable_entity_id: billableEntityId,
        entitlement_code: entitlementCode,
        window_start_at: windowStartAt,
        window_end_at: windowEndAt,
        usage_count: normalizedAmount,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        created_at: toInsertDateTime(payload.createdAt, now),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      })
      .onConflict(["billable_entity_id", "entitlement_code", "window_start_at", "window_end_at"])
      .merge(mergePatch);

    const row = await client("billing_usage_counters")
      .where({
        billable_entity_id: billableEntityId,
        entitlement_code: entitlementCode,
        window_start_at: windowStartAt,
        window_end_at: windowEndAt
      })
      .first();

    return mapUsageCounterRowNullable(row);
  }

  async function listUsageCountersForEntity({ billableEntityId, entitlementCode = null, limit = 200 }, options = {}) {
    const client = resolveClient(options);
    let query = client("billing_usage_counters")
      .where({
        billable_entity_id: Number(billableEntityId)
      });
    if (String(entitlementCode || "").trim()) {
      query = query.andWhere({ entitlement_code: String(entitlementCode || "").trim() });
    }

    const rows = await query
      .orderBy("window_start_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(1000, Number(limit) || 200)));

    return rows.map(mapUsageCounterRowNullable).filter(Boolean);
  }

  async function deleteUsageCountersOlderThan(cutoffDate, batchSize = 1000, options = {}) {
    const client = resolveClient(options);
    const normalizedBatchSize = Math.max(1, Math.min(10_000, Number(batchSize) || 1000));
    const cutoff = toInsertDateTime(cutoffDate, cutoffDate);
    const ids = await client("billing_usage_counters")
      .where("window_end_at", "<", cutoff)
      .orderBy("id", "asc")
      .limit(normalizedBatchSize)
      .select("id");

    if (!ids || ids.length < 1) {
      return 0;
    }

    const deleted = await client("billing_usage_counters")
      .whereIn("id", ids.map((entry) => Number(entry.id)))
      .delete();

    return Number(deleted || 0);
  }

  async function listBillingActivityEvents(filters = {}, options = {}) {
    const client = resolveClient(options);

    const requestedLimit = Number(filters?.limit);
    const normalizedLimit =
      Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.floor(requestedLimit) : 100;
    const normalizedWorkspaceId = toPositiveInteger(filters?.workspaceId);
    const normalizedOwnerUserId = toPositiveInteger(filters?.ownerUserId || filters?.userId);
    const normalizedBillableEntityId = toPositiveInteger(filters?.billableEntityId);
    const normalizedOperationKey = toNullableString(filters?.operationKey);
    const normalizedProviderEventId = toNullableString(filters?.providerEventId);
    const normalizedSource = String(filters?.source || "").trim().toLowerCase();
    const includeGlobal = filters?.includeGlobal !== false;
    const perSourceLimit = Math.max(50, normalizedLimit);

    const hasWorkspaceFilter = normalizedWorkspaceId != null;
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
        scopedQuery = scopedQuery.andWhere(`${entityAlias}.workspace_id`, normalizedWorkspaceId);
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
      let query = client("billing_subscriptions as bs")
        .join("billable_entities as be", "be.id", "bs.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["subscription"]),
          "bs.id as source_id",
          "bs.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          "bs.provider",
          client.raw("NULL as operation_key"),
          "bs.last_provider_event_id as provider_event_id",
          client.raw("? as event_type", ["subscription"]),
          "bs.status",
          "bs.updated_at as occurred_at",
          client.raw("NULL as message"),
          "bs.metadata_json as details_json"
        );

      query = applyEntityFilters(query, "bs.billable_entity_id");
      if (normalizedOperationKey) {
        query = query.andWhereRaw(
          "JSON_UNQUOTE(JSON_EXTRACT(bs.metadata_json, '$.operation_key')) = ?",
          [normalizedOperationKey]
        );
      }
      if (normalizedProviderEventId) {
        query = query.andWhere("bs.last_provider_event_id", normalizedProviderEventId);
      }

      query = query.orderBy("bs.updated_at", "desc").orderBy("bs.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }

    if (includeSource("invoice")) {
      let query = client("billing_invoices as bi")
        .join("billable_entities as be", "be.id", "bi.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["invoice"]),
          "bi.id as source_id",
          "bi.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          "bi.provider",
          client.raw("NULL as operation_key"),
          "bi.last_provider_event_id as provider_event_id",
          client.raw("? as event_type", ["invoice"]),
          "bi.status",
          "bi.updated_at as occurred_at",
          client.raw("NULL as message"),
          "bi.metadata_json as details_json"
        );

      query = applyEntityFilters(query, "bi.billable_entity_id");
      if (normalizedOperationKey) {
        query = query.andWhereRaw(
          "JSON_UNQUOTE(JSON_EXTRACT(bi.metadata_json, '$.operation_key')) = ?",
          [normalizedOperationKey]
        );
      }
      if (normalizedProviderEventId) {
        query = query.andWhere("bi.last_provider_event_id", normalizedProviderEventId);
      }

      query = query.orderBy("bi.updated_at", "desc").orderBy("bi.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }

    if (includeSource("payment")) {
      let query = client("billing_payments as bp")
        .join("billing_invoices as bi", "bi.id", "bp.invoice_id")
        .join("billable_entities as be", "be.id", "bi.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["payment"]),
          "bp.id as source_id",
          "bi.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          "bp.provider",
          client.raw("NULL as operation_key"),
          "bp.last_provider_event_id as provider_event_id",
          client.raw("? as event_type", ["payment"]),
          "bp.status",
          "bp.updated_at as occurred_at",
          client.raw("NULL as message"),
          "bp.metadata_json as details_json"
        );

      query = applyEntityFilters(query, "bi.billable_entity_id");
      if (normalizedOperationKey) {
        query = query.andWhere((builder) => {
          builder
            .whereRaw(
              "JSON_UNQUOTE(JSON_EXTRACT(bp.metadata_json, '$.operation_key')) = ?",
              [normalizedOperationKey]
            )
            .orWhereRaw(
              "JSON_UNQUOTE(JSON_EXTRACT(bi.metadata_json, '$.operation_key')) = ?",
              [normalizedOperationKey]
            );
        });
      }
      if (normalizedProviderEventId) {
        query = query.andWhere("bp.last_provider_event_id", normalizedProviderEventId);
      }

      query = query.orderBy("bp.updated_at", "desc").orderBy("bp.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }

    if (includeSource("payment_method_sync")) {
      let query = client("billing_payment_method_sync_events as bpmse")
        .join("billable_entities as be", "be.id", "bpmse.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["payment_method_sync"]),
          "bpmse.id as source_id",
          "bpmse.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          "bpmse.provider",
          client.raw("NULL as operation_key"),
          "bpmse.provider_event_id",
          "bpmse.event_type",
          "bpmse.status",
          "bpmse.updated_at as occurred_at",
          "bpmse.error_text as message",
          "bpmse.payload_json as details_json"
        );

      query = applyEntityFilters(query, "bpmse.billable_entity_id");
      if (normalizedOperationKey) {
        query = query.andWhereRaw(
          "JSON_UNQUOTE(JSON_EXTRACT(bpmse.payload_json, '$.operation_key')) = ?",
          [normalizedOperationKey]
        );
      }
      if (normalizedProviderEventId) {
        query = query.andWhere("bpmse.provider_event_id", normalizedProviderEventId);
      }

      query = query.orderBy("bpmse.updated_at", "desc").orderBy("bpmse.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }

    if (includeSource("webhook")) {
      let query = client("billing_webhook_events as bwe")
        .leftJoin("billable_entities as be", "be.id", "bwe.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["webhook"]),
          "bwe.id as source_id",
          "bwe.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          "bwe.provider",
          "bwe.operation_key",
          "bwe.provider_event_id",
          "bwe.event_type",
          "bwe.status",
          "bwe.updated_at as occurred_at",
          "bwe.error_text as message",
          "bwe.payload_json as details_json"
        );

      query = applyEntityFilters(query, "bwe.billable_entity_id");
      if (!includeGlobal && !hasEntityScopedFilter) {
        query = query.whereNotNull("bwe.billable_entity_id");
      }
      if (normalizedProviderEventId) {
        query = query.andWhere("bwe.provider_event_id", normalizedProviderEventId);
      }
      if (normalizedOperationKey) {
        query = query.andWhere((builder) => {
          builder
            .where("bwe.operation_key", normalizedOperationKey)
            .orWhereRaw(
              "JSON_UNQUOTE(JSON_EXTRACT(bwe.payload_json, '$.data.object.metadata.operation_key')) = ?",
              [normalizedOperationKey]
            );
        });
      }

      query = query.orderBy("bwe.updated_at", "desc").orderBy("bwe.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }

    if (includeSource("outbox_job")) {
      let query = client("billing_outbox_jobs as boj")
        .leftJoin("billable_entities as be", "be.id", "boj.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["outbox_job"]),
          "boj.id as source_id",
          "boj.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          client.raw("NULL as provider"),
          "boj.operation_key",
          "boj.provider_event_id",
          "boj.job_type as event_type",
          "boj.status",
          "boj.updated_at as occurred_at",
          "boj.last_error_text as message",
          "boj.payload_json as details_json"
        );

      query = applyEntityFilters(query, "boj.billable_entity_id");
      if (!includeGlobal && !hasEntityScopedFilter) {
        query = query.whereNotNull("boj.billable_entity_id");
      }
      if (normalizedOperationKey) {
        query = query.andWhere("boj.operation_key", normalizedOperationKey);
      }
      if (normalizedProviderEventId) {
        query = query.andWhere("boj.provider_event_id", normalizedProviderEventId);
      }

      query = query.orderBy("boj.updated_at", "desc").orderBy("boj.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }

    if (includeSource("remediation")) {
      let query = client("billing_subscription_remediations as bsr")
        .join("billable_entities as be", "be.id", "bsr.billable_entity_id")
        .leftJoin("workspaces as w", "w.id", "be.workspace_id")
        .select(
          client.raw("? as source", ["remediation"]),
          "bsr.id as source_id",
          "bsr.billable_entity_id",
          "be.workspace_id",
          "w.slug as workspace_slug",
          "w.name as workspace_name",
          "be.owner_user_id",
          "bsr.provider",
          "bsr.operation_key",
          "bsr.provider_event_id",
          "bsr.action as event_type",
          "bsr.status",
          "bsr.updated_at as occurred_at",
          "bsr.error_text as message",
          "bsr.metadata_json as details_json"
        );

      query = applyEntityFilters(query, "bsr.billable_entity_id");
      if (normalizedOperationKey) {
        query = query.andWhere("bsr.operation_key", normalizedOperationKey);
      }
      if (normalizedProviderEventId) {
        query = query.andWhere("bsr.provider_event_id", normalizedProviderEventId);
      }

      query = query.orderBy("bsr.updated_at", "desc").orderBy("bsr.id", "desc").limit(perSourceLimit);
      rows.push(...(await query));
    }

    if (includeGlobal && includeSource("reconciliation_run") && !hasEntityScopedFilter) {
      if (!normalizedOperationKey && !normalizedProviderEventId) {
        const query = client("billing_reconciliation_runs as brr")
          .select(
            client.raw("? as source", ["reconciliation_run"]),
            "brr.id as source_id",
            client.raw("NULL as billable_entity_id"),
            client.raw("NULL as workspace_id"),
            client.raw("NULL as workspace_slug"),
            client.raw("NULL as workspace_name"),
            client.raw("NULL as owner_user_id"),
            "brr.provider",
            client.raw("NULL as operation_key"),
            client.raw("NULL as provider_event_id"),
            "brr.scope as event_type",
            "brr.status",
            "brr.updated_at as occurred_at",
            "brr.error_text as message",
            client.raw(
              "JSON_OBJECT('summary', brr.summary_json, 'cursor', brr.cursor_json, 'scanned_count', brr.scanned_count, 'drift_detected_count', brr.drift_detected_count, 'repaired_count', brr.repaired_count) as details_json"
            )
          )
          .orderBy("brr.updated_at", "desc")
          .orderBy("brr.id", "desc")
          .limit(perSourceLimit);

        rows.push(...(await query));
      }
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
    const expectedLeaseVersion = Object.prototype.hasOwnProperty.call(options, "expectedLeaseVersion")
      ? Number(options.expectedLeaseVersion)
      : null;
    const dbPatch = {};

    function setRaw(key, value) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) {
        return;
      }
      dbPatch[key] = value;
    }

    setRaw("request_fingerprint_hash", patch.requestFingerprintHash);
    setRaw(
      "normalized_request_json",
      Object.prototype.hasOwnProperty.call(patch, "normalizedRequestJson")
        ? patch.normalizedRequestJson == null
          ? JSON.stringify({})
          : JSON.stringify(patch.normalizedRequestJson)
        : undefined
    );
    setRaw("operation_key", patch.operationKey);
    setRaw(
      "provider_request_params_json",
      Object.prototype.hasOwnProperty.call(patch, "providerRequestParamsJson")
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
    setRaw("provider", Object.prototype.hasOwnProperty.call(patch, "provider") ? normalizeProvider(patch.provider) : undefined);
    setRaw("provider_idempotency_key", patch.providerIdempotencyKey);
    setRaw("provider_idempotency_replay_deadline_at", toNullableDateTime(patch.providerIdempotencyReplayDeadlineAt));
    setRaw(
      "provider_checkout_session_expires_at_upper_bound",
      toNullableDateTime(patch.providerCheckoutSessionExpiresAtUpperBound)
    );
    setRaw("provider_session_id", patch.providerSessionId);
    setRaw(
      "response_json",
      Object.prototype.hasOwnProperty.call(patch, "responseJson")
        ? patch.responseJson == null
          ? null
          : JSON.stringify(patch.responseJson)
        : undefined
    );
    setRaw("status", patch.status);
    setRaw("pending_lease_expires_at", toNullableDateTime(patch.pendingLeaseExpiresAt));
    setRaw("pending_last_heartbeat_at", toNullableDateTime(patch.pendingLastHeartbeatAt));
    setRaw("lease_owner", patch.leaseOwner);
    setRaw("lease_version", Object.prototype.hasOwnProperty.call(patch, "leaseVersion") ? Number(patch.leaseVersion) : undefined);
    setRaw(
      "recovery_attempt_count",
      Object.prototype.hasOwnProperty.call(patch, "recoveryAttemptCount") ? Number(patch.recoveryAttemptCount) : undefined
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
      if (!Object.prototype.hasOwnProperty.call(patch, key)) {
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
      Object.prototype.hasOwnProperty.call(patch, "metadataJson")
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
    const query = client("billing_webhook_events")
      .where({ provider: normalizeProvider(provider), provider_event_id: providerEventId })
      .first();

    const row = await applyForUpdate(query, options);
    return mapWebhookEventRowNullable(row);
  }

  async function insertWebhookEvent(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);

    const [id] = await client("billing_webhook_events").insert({
      provider: normalizeProvider(payload.provider),
      provider_event_id: payload.providerEventId,
      billable_entity_id: toPositiveInteger(payload.billableEntityId),
      operation_key: toNullableString(payload.operationKey),
      event_type: payload.eventType,
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

    function setIfPresent(key, value) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) {
        return;
      }
      dbPatch[key] = value;
    }

    setIfPresent("status", patch.status);
    setIfPresent("processing_started_at", toNullableDateTime(patch.processingStartedAt));
    setIfPresent("processed_at", toNullableDateTime(patch.processedAt));
    setIfPresent("last_failed_at", toNullableDateTime(patch.lastFailedAt));
    setIfPresent("attempt_count", Object.prototype.hasOwnProperty.call(patch, "attemptCount") ? Number(patch.attemptCount) : undefined);
    setIfPresent("payload_retention_until", toNullableDateTime(patch.payloadRetentionUntil));
    setIfPresent("error_text", patch.errorText || null);
    setIfPresent(
      "billable_entity_id",
      Object.prototype.hasOwnProperty.call(patch, "billableEntityId") ? toPositiveInteger(patch.billableEntityId) : undefined
    );
    setIfPresent(
      "operation_key",
      Object.prototype.hasOwnProperty.call(patch, "operationKey") ? toNullableString(patch.operationKey) : undefined
    );

    for (const key of Object.keys(dbPatch)) {
      if (dbPatch[key] === undefined) {
        delete dbPatch[key];
      }
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toInsertDateTime(new Date(), new Date());
      await client("billing_webhook_events").where({ id }).update(dbPatch);
    }

    const row = await client("billing_webhook_events").where({ id }).first();
    return mapWebhookEventRowNullable(row);
  }

  async function listFailedWebhookEvents({ olderThan = null, limit = 200 }, options = {}) {
    const client = resolveClient(options);
    let query = client("billing_webhook_events").where({ status: "failed" });
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

    const rows = await client("billing_webhook_events")
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

    const updated = await client("billing_webhook_events").whereIn("id", ids).update({
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
    const now = new Date();
    const client = resolveClient(options);
    const normalizedPayloadJson = payloadJson && typeof payloadJson === "object" ? payloadJson : {};
    const inferredBillableEntityId = toPositiveInteger(
      billableEntityId ??
        normalizedPayloadJson.billableEntityId ??
        normalizedPayloadJson.billable_entity_id
    );
    const inferredOperationKey =
      toNullableString(operationKey) ||
      toNullableString(normalizedPayloadJson.operationKey) ||
      toNullableString(normalizedPayloadJson.operation_key);
    const inferredProviderEventId =
      toNullableString(providerEventId) ||
      toNullableString(normalizedPayloadJson.providerEventId) ||
      toNullableString(normalizedPayloadJson.provider_event_id);

    await client("billing_outbox_jobs")
      .insert({
        billable_entity_id: inferredBillableEntityId,
        operation_key: inferredOperationKey,
        provider_event_id: inferredProviderEventId,
        job_type: String(jobType || "").trim(),
        dedupe_key: String(dedupeKey || "").trim(),
        payload_json: JSON.stringify(normalizedPayloadJson),
        status: "pending",
        available_at: toInsertDateTime(availableAt, now),
        attempt_count: 0,
        lease_owner: null,
        lease_expires_at: null,
        lease_version: 1,
        last_error_text: null,
        finished_at: null,
        created_at: toInsertDateTime(now, now),
        updated_at: toInsertDateTime(now, now)
      })
      .onConflict(["job_type", "dedupe_key"])
      .ignore();

    const row = await client("billing_outbox_jobs")
      .where({ job_type: String(jobType || "").trim(), dedupe_key: String(dedupeKey || "").trim() })
      .first();
    return mapOutboxJobRowNullable(row);
  }

  async function upsertSubscriptionRemediation(payload, options = {}) {
    const now = new Date();
    const client = resolveClient(options);

    await client("billing_subscription_remediations")
      .insert({
        billable_entity_id: payload.billableEntityId,
        provider: normalizeProvider(payload.provider),
        operation_key: toNullableString(payload.operationKey),
        provider_event_id: toNullableString(payload.providerEventId),
        canonical_provider_subscription_id: payload.canonicalProviderSubscriptionId,
        canonical_subscription_id: payload.canonicalSubscriptionId || null,
        duplicate_provider_subscription_id: payload.duplicateProviderSubscriptionId,
        action: payload.action,
        status: payload.status || "pending",
        selection_algorithm_version: payload.selectionAlgorithmVersion,
        attempt_count: Number(payload.attemptCount || 0),
        next_attempt_at: toNullableDateTime(payload.nextAttemptAt),
        last_attempt_at: toNullableDateTime(payload.lastAttemptAt),
        resolved_at: toNullableDateTime(payload.resolvedAt),
        lease_owner: payload.leaseOwner || null,
        lease_expires_at: toNullableDateTime(payload.leaseExpiresAt),
        lease_version: Number(payload.leaseVersion || 1),
        error_text: payload.errorText || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        created_at: toInsertDateTime(payload.createdAt, now),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      })
      .onConflict(["provider", "duplicate_provider_subscription_id", "action"])
      .merge({
        canonical_provider_subscription_id: payload.canonicalProviderSubscriptionId,
        canonical_subscription_id: payload.canonicalSubscriptionId || null,
        status: payload.status || "pending",
        operation_key: toNullableString(payload.operationKey),
        provider_event_id: toNullableString(payload.providerEventId),
        selection_algorithm_version: payload.selectionAlgorithmVersion,
        next_attempt_at: toNullableDateTime(payload.nextAttemptAt),
        last_attempt_at: toNullableDateTime(payload.lastAttemptAt),
        resolved_at: toNullableDateTime(payload.resolvedAt),
        lease_owner: payload.leaseOwner || null,
        lease_expires_at: toNullableDateTime(payload.leaseExpiresAt),
        error_text: payload.errorText || null,
        metadata_json: payload.metadataJson == null ? null : JSON.stringify(payload.metadataJson),
        updated_at: toInsertDateTime(payload.updatedAt, now)
      });

    const row = await client("billing_subscription_remediations")
      .where({
        provider: normalizeProvider(payload.provider),
        duplicate_provider_subscription_id: payload.duplicateProviderSubscriptionId,
        action: payload.action
      })
      .first();

    return mapRemediationRowNullable(row);
  }

  async function leaseNextOutboxJob({ workerId, now = new Date(), leaseSeconds = 60 }, options = {}) {
    const client = resolveClient(options);
    const nowDate = normalizeDateInput(now) || new Date();
    const nowMysql = toInsertDateTime(nowDate, nowDate);

    const query = client("billing_outbox_jobs")
      .whereIn("status", ["pending", "failed"])
      .andWhere("available_at", "<=", nowMysql)
      .andWhere((builder) => {
        builder.whereNull("lease_expires_at").orWhere("lease_expires_at", "<=", nowMysql);
      })
      .orderBy("available_at", "asc")
      .orderBy("id", "asc")
      .first();

    const row = await applyForUpdate(query, {
      ...options,
      forUpdate: true
    });

    const candidate = mapOutboxJobRowNullable(row);
    if (!candidate) {
      return null;
    }

    const nextLeaseVersion = Number(candidate.leaseVersion || 0) + 1;
    const leaseExpiresAt = new Date(nowDate.getTime() + Math.max(1, Number(leaseSeconds) || 1) * 1000);

    const affectedRows = await client("billing_outbox_jobs")
      .where({ id: candidate.id, lease_version: candidate.leaseVersion })
      .update({
        status: "leased",
        lease_owner: String(workerId || "").trim() || null,
        lease_expires_at: toInsertDateTime(leaseExpiresAt, leaseExpiresAt),
        lease_version: nextLeaseVersion,
        updated_at: toInsertDateTime(nowDate, nowDate)
      });

    if (Number(affectedRows || 0) < 1) {
      return null;
    }

    const updatedRow = await client("billing_outbox_jobs").where({ id: candidate.id }).first();
    return mapOutboxJobRowNullable(updatedRow);
  }

  async function updateOutboxJobByLease({ id, leaseVersion, patch }, options = {}) {
    const client = resolveClient(options);
    const dbPatch = {
      updated_at: toInsertDateTime(new Date(), new Date())
    };

    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
      dbPatch.status = patch.status;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "availableAt")) {
      dbPatch.available_at = toNullableDateTime(patch.availableAt);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "attemptCount")) {
      dbPatch.attempt_count = Number(patch.attemptCount || 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "leaseOwner")) {
      dbPatch.lease_owner = patch.leaseOwner || null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "leaseExpiresAt")) {
      dbPatch.lease_expires_at = toNullableDateTime(patch.leaseExpiresAt);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "leaseVersion")) {
      dbPatch.lease_version = Number(patch.leaseVersion || 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "lastErrorText")) {
      dbPatch.last_error_text = patch.lastErrorText || null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "finishedAt")) {
      dbPatch.finished_at = toNullableDateTime(patch.finishedAt);
    }

    const affectedRows = await client("billing_outbox_jobs").where({ id, lease_version: leaseVersion }).update(dbPatch);
    if (Number(affectedRows || 0) < 1) {
      return null;
    }

    const row = await client("billing_outbox_jobs").where({ id }).first();
    return mapOutboxJobRowNullable(row);
  }

  async function leaseNextRemediation({ workerId, now = new Date(), leaseSeconds = 60 }, options = {}) {
    const client = resolveClient(options);
    const nowDate = normalizeDateInput(now) || new Date();
    const nowMysql = toInsertDateTime(nowDate, nowDate);

    const query = client("billing_subscription_remediations")
      .whereIn("status", ["pending", "failed"])
      .andWhere((builder) => {
        builder.whereNull("next_attempt_at").orWhere("next_attempt_at", "<=", nowMysql);
      })
      .andWhere((builder) => {
        builder.whereNull("lease_expires_at").orWhere("lease_expires_at", "<=", nowMysql);
      })
      .orderBy("updated_at", "asc")
      .orderBy("id", "asc")
      .first();

    const row = await applyForUpdate(query, {
      ...options,
      forUpdate: true
    });

    const candidate = mapRemediationRowNullable(row);
    if (!candidate) {
      return null;
    }

    const nextLeaseVersion = Number(candidate.leaseVersion || 0) + 1;
    const leaseExpiresAt = new Date(nowDate.getTime() + Math.max(1, Number(leaseSeconds) || 1) * 1000);

    const affectedRows = await client("billing_subscription_remediations")
      .where({ id: candidate.id, lease_version: candidate.leaseVersion })
      .update({
        status: "in_progress",
        lease_owner: String(workerId || "").trim() || null,
        lease_expires_at: toInsertDateTime(leaseExpiresAt, leaseExpiresAt),
        lease_version: nextLeaseVersion,
        updated_at: toInsertDateTime(nowDate, nowDate)
      });

    if (Number(affectedRows || 0) < 1) {
      return null;
    }

    const updatedRow = await client("billing_subscription_remediations").where({ id: candidate.id }).first();
    return mapRemediationRowNullable(updatedRow);
  }

  async function updateRemediationByLease({ id, leaseVersion, patch }, options = {}) {
    const client = resolveClient(options);
    const dbPatch = {
      updated_at: toInsertDateTime(new Date(), new Date())
    };

    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
      dbPatch.status = patch.status;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "attemptCount")) {
      dbPatch.attempt_count = Number(patch.attemptCount || 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "nextAttemptAt")) {
      dbPatch.next_attempt_at = toNullableDateTime(patch.nextAttemptAt);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "lastAttemptAt")) {
      dbPatch.last_attempt_at = toNullableDateTime(patch.lastAttemptAt);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "resolvedAt")) {
      dbPatch.resolved_at = toNullableDateTime(patch.resolvedAt);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "leaseOwner")) {
      dbPatch.lease_owner = patch.leaseOwner || null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "leaseExpiresAt")) {
      dbPatch.lease_expires_at = toNullableDateTime(patch.leaseExpiresAt);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "leaseVersion")) {
      dbPatch.lease_version = Number(patch.leaseVersion || 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "errorText")) {
      dbPatch.error_text = patch.errorText || null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "canonicalSubscriptionId")) {
      dbPatch.canonical_subscription_id = patch.canonicalSubscriptionId || null;
    }

    const affectedRows = await client("billing_subscription_remediations")
      .where({ id, lease_version: leaseVersion })
      .update(dbPatch);
    if (Number(affectedRows || 0) < 1) {
      return null;
    }

    const row = await client("billing_subscription_remediations").where({ id }).first();
    return mapRemediationRowNullable(row);
  }

  async function acquireReconciliationRun({ provider, scope, runnerId, now = new Date(), leaseSeconds = 120 }, options = {}) {
    const client = resolveClient(options);
    const normalizedProvider = normalizeProvider(provider);
    const normalizedScope = String(scope || "").trim();
    const nowDate = normalizeDateInput(now) || new Date();

    const query = client("billing_reconciliation_runs")
      .where({ provider: normalizedProvider, scope: normalizedScope, status: "running" })
      .orderBy("id", "desc")
      .first();
    const existing = mapReconciliationRunRowNullable(
      await applyForUpdate(query, {
        ...options,
        forUpdate: true
      })
    );

    const leaseExpiresAt = new Date(nowDate.getTime() + Math.max(1, Number(leaseSeconds) || 1) * 1000);

    if (existing) {
      const existingLeaseExpires = normalizeDateInput(existing.leaseExpiresAt);
      if (existingLeaseExpires && existingLeaseExpires.getTime() > nowDate.getTime()) {
        return {
          acquired: false,
          run: existing
        };
      }

      const nextLeaseVersion = Number(existing.leaseVersion || 0) + 1;
      const affectedRows = await client("billing_reconciliation_runs")
        .where({ id: existing.id, lease_version: existing.leaseVersion })
        .update({
          runner_id: String(runnerId || "").trim() || null,
          lease_expires_at: toInsertDateTime(leaseExpiresAt, leaseExpiresAt),
          lease_version: nextLeaseVersion,
          updated_at: toInsertDateTime(nowDate, nowDate)
        });

      if (Number(affectedRows || 0) < 1) {
        const latest = await client("billing_reconciliation_runs").where({ id: existing.id }).first();
        return {
          acquired: false,
          run: mapReconciliationRunRowNullable(latest) || existing
        };
      }

      const row = await client("billing_reconciliation_runs").where({ id: existing.id }).first();
      return {
        acquired: true,
        run: mapReconciliationRunRowNullable(row)
      };
    }

    try {
      const [id] = await client("billing_reconciliation_runs").insert({
        provider: normalizedProvider,
        scope: normalizedScope,
        status: "running",
        runner_id: String(runnerId || "").trim() || null,
        lease_expires_at: toInsertDateTime(leaseExpiresAt, leaseExpiresAt),
        lease_version: 1,
        started_at: toInsertDateTime(nowDate, nowDate),
        finished_at: null,
        cursor_json: null,
        summary_json: null,
        scanned_count: 0,
        drift_detected_count: 0,
        repaired_count: 0,
        error_text: null,
        created_at: toInsertDateTime(nowDate, nowDate),
        updated_at: toInsertDateTime(nowDate, nowDate)
      });

      const row = await client("billing_reconciliation_runs").where({ id }).first();
      return {
        acquired: true,
        run: mapReconciliationRunRowNullable(row)
      };
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }

      const latestQuery = client("billing_reconciliation_runs")
        .where({ provider: normalizedProvider, scope: normalizedScope, status: "running" })
        .orderBy("id", "desc")
        .first();
      const latest = mapReconciliationRunRowNullable(
        await applyForUpdate(latestQuery, {
          ...options,
          forUpdate: true
        })
      );

      return {
        acquired: false,
        run: latest
      };
    }
  }

  async function updateReconciliationRunByLease({ id, leaseVersion, patch }, options = {}) {
    const client = resolveClient(options);
    const dbPatch = {
      updated_at: toInsertDateTime(new Date(), new Date())
    };

    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
      dbPatch.status = patch.status;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "runnerId")) {
      dbPatch.runner_id = patch.runnerId || null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "leaseExpiresAt")) {
      dbPatch.lease_expires_at = toNullableDateTime(patch.leaseExpiresAt);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "leaseVersion")) {
      dbPatch.lease_version = Number(patch.leaseVersion || 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "finishedAt")) {
      dbPatch.finished_at = toNullableDateTime(patch.finishedAt);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "cursorJson")) {
      dbPatch.cursor_json = patch.cursorJson == null ? null : JSON.stringify(patch.cursorJson);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "summaryJson")) {
      dbPatch.summary_json = patch.summaryJson == null ? null : JSON.stringify(patch.summaryJson);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "scannedCount")) {
      dbPatch.scanned_count = Number(patch.scannedCount || 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "driftDetectedCount")) {
      dbPatch.drift_detected_count = Number(patch.driftDetectedCount || 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "repairedCount")) {
      dbPatch.repaired_count = Number(patch.repairedCount || 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "errorText")) {
      dbPatch.error_text = patch.errorText || null;
    }

    const affectedRows = await client("billing_reconciliation_runs").where({ id, lease_version: leaseVersion }).update(dbPatch);
    if (Number(affectedRows || 0) < 1) {
      return null;
    }

    const row = await client("billing_reconciliation_runs").where({ id }).first();
    return mapReconciliationRunRowNullable(row);
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
    listPlanPricesForPlan,
    findPlanPriceByProviderPriceId,
    findSellablePlanPricesForPlan,
    listPlanEntitlementsForPlan,
    findCustomerById,
    findCustomerByEntityProvider,
    findCustomerByProviderCustomerId,
    upsertCustomer,
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
  normalizeBillableEntityType,
  mapBillableEntityRowNullable,
  mapPlanRowNullable,
  mapPlanPriceRowNullable,
  mapEntitlementRowNullable,
  mapCustomerRowNullable,
  mapSubscriptionRowNullable,
  mapSubscriptionItemRowNullable,
  mapInvoiceRowNullable,
  mapPaymentRowNullable,
  mapPaymentMethodRowNullable,
  mapPaymentMethodSyncEventRowNullable,
  mapUsageCounterRowNullable,
  mapBillingActivityRowNullable,
  mapIdempotencyRowNullable,
  mapCheckoutSessionRowNullable,
  mapWebhookEventRowNullable,
  mapOutboxJobRowNullable,
  mapRemediationRowNullable,
  mapReconciliationRunRowNullable,
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
  listPlanPricesForPlan,
  findPlanPriceByProviderPriceId,
  findSellablePlanPricesForPlan,
  listPlanEntitlementsForPlan,
  findCustomerById,
  findCustomerByEntityProvider,
  findCustomerByProviderCustomerId,
  upsertCustomer,
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
