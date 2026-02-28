import { normalizeAmountAllowZero, normalizeAmountRequirePositive } from "@jskit-ai/billing-core";
import { normalizeDateInput } from "@jskit-ai/jskit-knex/dateUtils";
import { applyForUpdate, parseJsonValue, resolveRepoClient } from "@jskit-ai/jskit-knex";
import { withTransaction } from "./transactions.js";

const DEFAULT_TABLE_NAMES = Object.freeze({
  entitlementDefinitions: "billing_entitlement_definitions",
  entitlementGrants: "billing_entitlement_grants",
  entitlementConsumptions: "billing_entitlement_consumptions",
  entitlementBalances: "billing_entitlement_balances"
});

const DEFAULT_DIALECT_FEATURES = Object.freeze({
  skipLocked: true
});

const LIFETIME_WINDOW_START = new Date("1970-01-01T00:00:00.000Z");
const LIFETIME_WINDOW_END = new Date("9999-12-31T23:59:59.999Z");

function toNonEmptyString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function toNullableString(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function toInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
}

function toIsoString(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) {
    return null;
  }
  return normalized.toISOString();
}

function toDatabaseDateTimeUtc(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) {
    return null;
  }

  const yyyy = String(normalized.getUTCFullYear()).padStart(4, "0");
  const mm = String(normalized.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(normalized.getUTCDate()).padStart(2, "0");
  const hh = String(normalized.getUTCHours()).padStart(2, "0");
  const mi = String(normalized.getUTCMinutes()).padStart(2, "0");
  const ss = String(normalized.getUTCSeconds()).padStart(2, "0");
  const mmm = String(normalized.getUTCMilliseconds()).padStart(3, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${mmm}`;
}

function toInsertDateTime(dateLike, fallback = new Date()) {
  const normalized = normalizeDateInput(dateLike) || normalizeDateInput(fallback) || new Date();
  return toDatabaseDateTimeUtc(normalized);
}

function toNullableDateTime(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) {
    return null;
  }
  return toDatabaseDateTimeUtc(normalized);
}

function toDateTimeQueryValue(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(trimmed)) {
      return trimmed;
    }
  }

  return toNullableDateTime(value);
}

function normalizeMetadataJsonInput(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function normalizeSubjectType(value) {
  return toNonEmptyString(value).toLowerCase() || "billable_entity";
}

function isDuplicateEntryError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  if (code === "ER_DUP_ENTRY") {
    return true;
  }

  const errno = Number(error?.errno || error?.errorno || 0);
  return errno === 1062;
}

function normalizeTableNames(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return {
    entitlementDefinitions: toNonEmptyString(source.entitlementDefinitions) || DEFAULT_TABLE_NAMES.entitlementDefinitions,
    entitlementGrants: toNonEmptyString(source.entitlementGrants) || DEFAULT_TABLE_NAMES.entitlementGrants,
    entitlementConsumptions:
      toNonEmptyString(source.entitlementConsumptions) || DEFAULT_TABLE_NAMES.entitlementConsumptions,
    entitlementBalances: toNonEmptyString(source.entitlementBalances) || DEFAULT_TABLE_NAMES.entitlementBalances
  };
}

function normalizeDialectFeatures(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    skipLocked:
      source.skipLocked == null ? DEFAULT_DIALECT_FEATURES.skipLocked : source.skipLocked === true || source.skipLocked === 1
  };
}

function mapDefinitionRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    description: row.description == null ? null : String(row.description),
    entitlementType: String(row.entitlement_type || ""),
    unit: String(row.unit || ""),
    windowInterval: row.window_interval == null ? null : String(row.window_interval),
    windowAnchor: row.window_anchor == null ? null : String(row.window_anchor),
    aggregationMode: String(row.aggregation_mode || "sum"),
    enforcementMode: String(row.enforcement_mode || "hard_deny"),
    scopeType: String(row.scope_type || "billable_entity"),
    isActive: Boolean(row.is_active),
    metadataJson: parseJsonValue(row.metadata_json, {}, { allowNull: true }),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapGrantRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    subjectType: String(row.subject_type || "billable_entity"),
    subjectId: Number(row.subject_id),
    entitlementDefinitionId: Number(row.entitlement_definition_id),
    amount: Number(row.amount || 0),
    kind: String(row.kind || ""),
    effectiveAt: toIsoString(row.effective_at),
    expiresAt: toIsoString(row.expires_at),
    sourceType: String(row.source_type || ""),
    sourceId: row.source_id == null ? null : Number(row.source_id),
    operationKey: toNullableString(row.operation_key),
    provider: toNullableString(row.provider),
    providerEventId: toNullableString(row.provider_event_id),
    dedupeKey: String(row.dedupe_key || ""),
    metadataJson: parseJsonValue(row.metadata_json, {}, { allowNull: true }),
    createdAt: toIsoString(row.created_at)
  };
}

function mapConsumptionRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    subjectType: String(row.subject_type || "billable_entity"),
    subjectId: Number(row.subject_id),
    entitlementDefinitionId: Number(row.entitlement_definition_id),
    amount: Number(row.amount || 0),
    occurredAt: toIsoString(row.occurred_at),
    reasonCode: String(row.reason_code || ""),
    operationKey: toNullableString(row.operation_key),
    usageEventKey: toNullableString(row.usage_event_key),
    providerEventId: toNullableString(row.provider_event_id),
    requestId: toNullableString(row.request_id),
    dedupeKey: String(row.dedupe_key || ""),
    metadataJson: parseJsonValue(row.metadata_json, {}, { allowNull: true }),
    createdAt: toIsoString(row.created_at)
  };
}

function mapBalanceRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    subjectType: String(row.subject_type || "billable_entity"),
    subjectId: Number(row.subject_id),
    entitlementDefinitionId: Number(row.entitlement_definition_id),
    windowStartAt: toIsoString(row.window_start_at),
    windowEndAt: toIsoString(row.window_end_at),
    grantedAmount: Number(row.granted_amount || 0),
    consumedAmount: Number(row.consumed_amount || 0),
    effectiveAmount: Number(row.effective_amount || 0),
    hardLimitAmount: row.hard_limit_amount == null ? null : Number(row.hard_limit_amount),
    overLimit: Boolean(row.over_limit),
    lockState: row.lock_state == null ? null : String(row.lock_state),
    nextChangeAt: toIsoString(row.next_change_at),
    lastRecomputedAt: toIsoString(row.last_recomputed_at),
    version: Number(row.version || 0),
    metadataJson: parseJsonValue(row.metadata_json, {}, { allowNull: true }),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function normalizeNow(now, clock) {
  return normalizeDateInput(now) || normalizeDateInput(clock?.now?.()) || new Date();
}

function startOfUtcDay(referenceDate) {
  return new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate(), 0, 0, 0, 0)
  );
}

function startOfUtcWeek(referenceDate) {
  const start = startOfUtcDay(referenceDate);
  const weekday = start.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  start.setUTCDate(start.getUTCDate() + mondayOffset);
  return start;
}

function startOfUtcMonth(referenceDate) {
  return new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1, 0, 0, 0, 0));
}

function startOfUtcYear(referenceDate) {
  return new Date(Date.UTC(referenceDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
}

function addUtcDays(referenceDate, days) {
  return new Date(referenceDate.getTime() + Number(days) * 24 * 60 * 60 * 1000);
}

function resolveCalendarWindow(interval, now = new Date()) {
  const referenceDate = normalizeDateInput(now) || new Date();
  const normalizedInterval = toNonEmptyString(interval).toLowerCase();

  if (normalizedInterval === "day") {
    const windowStartAt = startOfUtcDay(referenceDate);
    return {
      windowStartAt,
      windowEndAt: addUtcDays(windowStartAt, 1)
    };
  }

  if (normalizedInterval === "week") {
    const windowStartAt = startOfUtcWeek(referenceDate);
    return {
      windowStartAt,
      windowEndAt: addUtcDays(windowStartAt, 7)
    };
  }

  if (normalizedInterval === "month") {
    const windowStartAt = startOfUtcMonth(referenceDate);
    return {
      windowStartAt,
      windowEndAt: new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, 1, 0, 0, 0, 0))
    };
  }

  if (normalizedInterval === "year") {
    const windowStartAt = startOfUtcYear(referenceDate);
    return {
      windowStartAt,
      windowEndAt: new Date(Date.UTC(referenceDate.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0))
    };
  }

  return {
    windowStartAt: new Date(LIFETIME_WINDOW_START),
    windowEndAt: new Date(LIFETIME_WINDOW_END)
  };
}

function assertKnexLike(knex) {
  if (!knex || (typeof knex !== "function" && typeof knex !== "object")) {
    throw new Error("createEntitlementsKnexRepository requires options.knex.");
  }
}

function assertMysqlScope(knex) {
  const configured =
    knex?.client?.config?.client ||
    knex?.client?.dialect ||
    knex?.client?.driverName ||
    knex?.client?.constructor?.name ||
    "";

  if (!configured) {
    return;
  }

  const normalized = String(configured).trim().toLowerCase();
  if (!normalized.includes("mysql")) {
    throw new Error(`createEntitlementsKnexRepository is MySQL-scoped. Received client "${configured}".`);
  }
}

export function createEntitlementsKnexRepository(options = {}) {
  const knex = options?.knex;
  assertKnexLike(knex);
  assertMysqlScope(knex);

  const tableNames = normalizeTableNames(options.tableNames);
  const dialectFeatures = normalizeDialectFeatures(options.dialectFeatures);
  const clock = options.clock && typeof options.clock === "object" ? options.clock : { now: () => new Date() };

  const resolveCapacityConsumedAmount =
    typeof options.resolveCapacityConsumedAmount === "function" ? options.resolveCapacityConsumedAmount : null;
  const resolveLockState = typeof options.resolveLockState === "function" ? options.resolveLockState : null;

  async function transaction(work) {
    return withTransaction(knex, work);
  }

  async function listEntitlementDefinitions({ includeInactive = true, codes = null } = {}, queryOptions = {}) {
    const client = resolveRepoClient(knex, queryOptions);
    let query = client(tableNames.entitlementDefinitions).orderBy("id", "asc");
    if (!includeInactive) {
      query = query.where({ is_active: 1 });
    }

    if (Array.isArray(codes) && codes.length > 0) {
      const normalizedCodes = [...new Set(codes.map((entry) => toNonEmptyString(entry)).filter(Boolean))];
      if (normalizedCodes.length > 0) {
        query = query.whereIn("code", normalizedCodes);
      }
    }

    const rows = await query;
    return rows.map(mapDefinitionRowNullable).filter(Boolean);
  }

  async function findEntitlementDefinitionByCode(code, queryOptions = {}) {
    const normalizedCode = toNonEmptyString(code);
    if (!normalizedCode) {
      return null;
    }

    const client = resolveRepoClient(knex, queryOptions);
    const query = client(tableNames.entitlementDefinitions).where({ code: normalizedCode }).first();
    const row = await applyForUpdate(query, queryOptions);
    return mapDefinitionRowNullable(row);
  }

  async function findEntitlementDefinitionById(id, queryOptions = {}) {
    const normalizedId = toPositiveInteger(id);
    if (!normalizedId) {
      return null;
    }

    const client = resolveRepoClient(knex, queryOptions);
    const query = client(tableNames.entitlementDefinitions).where({ id: normalizedId }).first();
    const row = await applyForUpdate(query, queryOptions);
    return mapDefinitionRowNullable(row);
  }

  async function insertEntitlementGrant(payload = {}, queryOptions = {}) {
    const client = resolveRepoClient(knex, queryOptions);
    const now = normalizeNow(payload.createdAt || payload.created_at, clock);

    const dedupeKey = toNonEmptyString(payload.dedupeKey || payload.dedupe_key);
    if (!dedupeKey) {
      throw new Error("insertEntitlementGrant requires payload.dedupeKey.");
    }

    const subjectId = toPositiveInteger(payload.subjectId ?? payload.subject_id);
    const entitlementDefinitionId = toPositiveInteger(payload.entitlementDefinitionId ?? payload.entitlement_definition_id);
    if (!subjectId || !entitlementDefinitionId) {
      throw new Error("insertEntitlementGrant requires subjectId and entitlementDefinitionId.");
    }

    const amount = normalizeAmountAllowZero(payload.amount, { allowNegative: true });
    if (amount == null || amount === 0) {
      throw new Error("insertEntitlementGrant requires payload.amount to be a non-zero integer.");
    }

    const insertPayload = {
      subject_type: normalizeSubjectType(payload.subjectType ?? payload.subject_type),
      subject_id: subjectId,
      entitlement_definition_id: entitlementDefinitionId,
      amount,
      kind: toNonEmptyString(payload.kind).toLowerCase() || "manual_adjustment",
      effective_at: toInsertDateTime(payload.effectiveAt ?? payload.effective_at, now),
      expires_at: toNullableDateTime(payload.expiresAt ?? payload.expires_at),
      source_type: toNonEmptyString(payload.sourceType ?? payload.source_type).toLowerCase() || "manual_console",
      source_id:
        payload.sourceId == null && payload.source_id == null ? null : Number(payload.sourceId ?? payload.source_id),
      operation_key: toNullableString(payload.operationKey ?? payload.operation_key),
      provider: toNullableString(payload.provider),
      provider_event_id: toNullableString(payload.providerEventId ?? payload.provider_event_id),
      dedupe_key: dedupeKey,
      metadata_json: normalizeMetadataJsonInput(payload.metadataJson ?? payload.metadata_json),
      created_at: toInsertDateTime(payload.createdAt ?? payload.created_at, now)
    };

    const existing = await client(tableNames.entitlementGrants).where({ dedupe_key: dedupeKey }).first();
    if (existing) {
      return {
        inserted: false,
        grant: mapGrantRowNullable(existing)
      };
    }

    try {
      await client(tableNames.entitlementGrants).insert(insertPayload);
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }

      const duplicateRow = await client(tableNames.entitlementGrants).where({ dedupe_key: dedupeKey }).first();
      return {
        inserted: false,
        grant: mapGrantRowNullable(duplicateRow)
      };
    }

    const insertedRow = await client(tableNames.entitlementGrants).where({ dedupe_key: dedupeKey }).first();
    return {
      inserted: true,
      grant: mapGrantRowNullable(insertedRow)
    };
  }

  async function insertEntitlementConsumption(payload = {}, queryOptions = {}) {
    const client = resolveRepoClient(knex, queryOptions);
    const now = normalizeNow(payload.createdAt || payload.created_at, clock);

    const dedupeKey = toNonEmptyString(payload.dedupeKey || payload.dedupe_key);
    if (!dedupeKey) {
      throw new Error("insertEntitlementConsumption requires payload.dedupeKey.");
    }

    const subjectId = toPositiveInteger(payload.subjectId ?? payload.subject_id);
    const entitlementDefinitionId = toPositiveInteger(payload.entitlementDefinitionId ?? payload.entitlement_definition_id);
    const amount = normalizeAmountRequirePositive(payload.amount);
    if (!subjectId || !entitlementDefinitionId || amount == null) {
      throw new Error(
        "insertEntitlementConsumption requires subjectId, entitlementDefinitionId, and a positive amount."
      );
    }

    const insertPayload = {
      subject_type: normalizeSubjectType(payload.subjectType ?? payload.subject_type),
      subject_id: subjectId,
      entitlement_definition_id: entitlementDefinitionId,
      amount,
      occurred_at: toInsertDateTime(payload.occurredAt ?? payload.occurred_at, now),
      reason_code: toNonEmptyString(payload.reasonCode ?? payload.reason_code).toLowerCase() || "usage",
      operation_key: toNullableString(payload.operationKey ?? payload.operation_key),
      usage_event_key: toNullableString(payload.usageEventKey ?? payload.usage_event_key),
      provider_event_id: toNullableString(payload.providerEventId ?? payload.provider_event_id),
      request_id: toNullableString(payload.requestId ?? payload.request_id),
      dedupe_key: dedupeKey,
      metadata_json: normalizeMetadataJsonInput(payload.metadataJson ?? payload.metadata_json),
      created_at: toInsertDateTime(payload.createdAt ?? payload.created_at, now)
    };

    const existing = await client(tableNames.entitlementConsumptions).where({ dedupe_key: dedupeKey }).first();
    if (existing) {
      return {
        inserted: false,
        consumption: mapConsumptionRowNullable(existing)
      };
    }

    try {
      await client(tableNames.entitlementConsumptions).insert(insertPayload);
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }

      const duplicateRow = await client(tableNames.entitlementConsumptions).where({ dedupe_key: dedupeKey }).first();
      return {
        inserted: false,
        consumption: mapConsumptionRowNullable(duplicateRow)
      };
    }

    const insertedRow = await client(tableNames.entitlementConsumptions).where({ dedupe_key: dedupeKey }).first();
    return {
      inserted: true,
      consumption: mapConsumptionRowNullable(insertedRow)
    };
  }

  async function findEntitlementBalance(
    { subjectType = "billable_entity", subjectId, entitlementDefinitionId, windowStartAt = null, windowEndAt = null },
    queryOptions = {}
  ) {
    const normalizedSubjectId = toPositiveInteger(subjectId);
    const normalizedDefinitionId = toPositiveInteger(entitlementDefinitionId);
    if (!normalizedSubjectId || !normalizedDefinitionId) {
      return null;
    }

    const client = resolveRepoClient(knex, queryOptions);
    let query = client(tableNames.entitlementBalances).where({
      subject_type: normalizeSubjectType(subjectType),
      subject_id: normalizedSubjectId,
      entitlement_definition_id: normalizedDefinitionId
    });

    const normalizedWindowStartAt = toDateTimeQueryValue(windowStartAt);
    const normalizedWindowEndAt = toDateTimeQueryValue(windowEndAt);
    if (normalizedWindowStartAt) {
      query = query.andWhere("window_start_at", normalizedWindowStartAt);
    }
    if (normalizedWindowEndAt) {
      query = query.andWhere("window_end_at", normalizedWindowEndAt);
    }

    query = query.orderBy("window_end_at", "desc").orderBy("id", "desc");
    const row = await applyForUpdate(query.first(), queryOptions);
    return mapBalanceRowNullable(row);
  }

  async function upsertEntitlementBalance(payload = {}, queryOptions = {}) {
    const client = resolveRepoClient(knex, queryOptions);
    const now = normalizeNow(payload.updatedAt || payload.updated_at, clock);

    const subjectId = toPositiveInteger(payload.subjectId ?? payload.subject_id);
    const entitlementDefinitionId = toPositiveInteger(payload.entitlementDefinitionId ?? payload.entitlement_definition_id);
    if (!subjectId || !entitlementDefinitionId) {
      throw new Error("upsertEntitlementBalance requires subjectId and entitlementDefinitionId.");
    }

    const windowStartAt =
      toNullableDateTime(payload.windowStartAt ?? payload.window_start_at) || toInsertDateTime(LIFETIME_WINDOW_START, now);
    const windowEndAt =
      toNullableDateTime(payload.windowEndAt ?? payload.window_end_at) || toInsertDateTime(LIFETIME_WINDOW_END, now);

    const insertPayload = {
      subject_type: normalizeSubjectType(payload.subjectType ?? payload.subject_type),
      subject_id: subjectId,
      entitlement_definition_id: entitlementDefinitionId,
      window_start_at: windowStartAt,
      window_end_at: windowEndAt,
      granted_amount: Number(payload.grantedAmount ?? payload.granted_amount ?? 0),
      consumed_amount: Number(payload.consumedAmount ?? payload.consumed_amount ?? 0),
      effective_amount: Number(payload.effectiveAmount ?? payload.effective_amount ?? 0),
      hard_limit_amount:
        payload.hardLimitAmount == null && payload.hard_limit_amount == null
          ? null
          : Number(payload.hardLimitAmount ?? payload.hard_limit_amount),
      over_limit: payload.overLimit || payload.over_limit ? 1 : 0,
      lock_state: toNullableString(payload.lockState ?? payload.lock_state),
      next_change_at: toNullableDateTime(payload.nextChangeAt ?? payload.next_change_at),
      last_recomputed_at: toInsertDateTime(payload.lastRecomputedAt ?? payload.last_recomputed_at, now),
      version: Number(payload.version || 0),
      metadata_json: normalizeMetadataJsonInput(payload.metadataJson ?? payload.metadata_json),
      created_at: toInsertDateTime(payload.createdAt ?? payload.created_at, now),
      updated_at: toInsertDateTime(payload.updatedAt ?? payload.updated_at, now)
    };

    await client(tableNames.entitlementBalances)
      .insert(insertPayload)
      .onConflict(["subject_type", "subject_id", "entitlement_definition_id", "window_start_at", "window_end_at"])
      .merge({
        granted_amount: insertPayload.granted_amount,
        consumed_amount: insertPayload.consumed_amount,
        effective_amount: insertPayload.effective_amount,
        hard_limit_amount: insertPayload.hard_limit_amount,
        over_limit: insertPayload.over_limit,
        lock_state: insertPayload.lock_state,
        next_change_at: insertPayload.next_change_at,
        last_recomputed_at: insertPayload.last_recomputed_at,
        metadata_json: insertPayload.metadata_json,
        version: client.raw("version + 1"),
        updated_at: insertPayload.updated_at
      });

    return findEntitlementBalance(
      {
        subjectType: insertPayload.subject_type,
        subjectId,
        entitlementDefinitionId,
        windowStartAt: insertPayload.window_start_at,
        windowEndAt: insertPayload.window_end_at
      },
      {
        ...queryOptions,
        trx: client
      }
    );
  }

  async function listEntitlementBalancesForSubject(
    { subjectType = "billable_entity", subjectId, entitlementDefinitionIds = null } = {},
    queryOptions = {}
  ) {
    const normalizedSubjectId = toPositiveInteger(subjectId);
    if (!normalizedSubjectId) {
      return [];
    }

    const client = resolveRepoClient(knex, queryOptions);
    let query = client(tableNames.entitlementBalances).where({
      subject_type: normalizeSubjectType(subjectType),
      subject_id: normalizedSubjectId
    });

    if (Array.isArray(entitlementDefinitionIds) && entitlementDefinitionIds.length > 0) {
      const normalizedDefinitionIds = entitlementDefinitionIds.map((entry) => toPositiveInteger(entry)).filter(Boolean);
      if (normalizedDefinitionIds.length > 0) {
        query = query.whereIn("entitlement_definition_id", normalizedDefinitionIds);
      }
    }

    const rows = await query.orderBy("entitlement_definition_id", "asc").orderBy("window_end_at", "desc");
    return rows.map(mapBalanceRowNullable).filter(Boolean);
  }

  async function listNextGrantBoundariesForSubjectDefinition(
    { subjectType = "billable_entity", subjectId, entitlementDefinitionId, now = normalizeNow(null, clock) },
    queryOptions = {}
  ) {
    const normalizedSubjectId = toPositiveInteger(subjectId);
    const normalizedDefinitionId = toPositiveInteger(entitlementDefinitionId);
    if (!normalizedSubjectId || !normalizedDefinitionId) {
      return [];
    }

    const client = resolveRepoClient(knex, queryOptions);
    const normalizedNow = toInsertDateTime(now, normalizeNow(null, clock));

    const nextEffectiveRow = await client(tableNames.entitlementGrants)
      .where({
        subject_type: normalizeSubjectType(subjectType),
        subject_id: normalizedSubjectId,
        entitlement_definition_id: normalizedDefinitionId
      })
      .andWhere("effective_at", ">", normalizedNow)
      .min({ next_at: "effective_at" })
      .first();

    const nextExpiryRow = await client(tableNames.entitlementGrants)
      .where({
        subject_type: normalizeSubjectType(subjectType),
        subject_id: normalizedSubjectId,
        entitlement_definition_id: normalizedDefinitionId
      })
      .whereNotNull("expires_at")
      .andWhere("expires_at", ">", normalizedNow)
      .min({ next_at: "expires_at" })
      .first();

    return [toIsoString(nextEffectiveRow?.next_at), toIsoString(nextExpiryRow?.next_at)]
      .filter(Boolean)
      .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
  }

  async function sumEntitlementGrantAmount(
    { subjectType = "billable_entity", subjectId, entitlementDefinitionId, now = normalizeNow(null, clock) } = {},
    queryOptions = {}
  ) {
    const normalizedSubjectId = toPositiveInteger(subjectId);
    const normalizedDefinitionId = toPositiveInteger(entitlementDefinitionId);
    if (!normalizedSubjectId || !normalizedDefinitionId) {
      return 0;
    }

    const normalizedNow = toInsertDateTime(now, normalizeNow(null, clock));
    const client = resolveRepoClient(knex, queryOptions);
    const row = await client(tableNames.entitlementGrants)
      .where({
        subject_type: normalizeSubjectType(subjectType),
        subject_id: normalizedSubjectId,
        entitlement_definition_id: normalizedDefinitionId
      })
      .andWhere("effective_at", "<=", normalizedNow)
      .andWhere((builder) => {
        builder.whereNull("expires_at").orWhere("expires_at", ">", normalizedNow);
      })
      .sum({ total: "amount" })
      .first();

    return Number(row?.total || 0);
  }

  async function sumEntitlementConsumptionAmount(
    { subjectType = "billable_entity", subjectId, entitlementDefinitionId, windowStartAt, windowEndAt } = {},
    queryOptions = {}
  ) {
    const normalizedSubjectId = toPositiveInteger(subjectId);
    const normalizedDefinitionId = toPositiveInteger(entitlementDefinitionId);
    if (!normalizedSubjectId || !normalizedDefinitionId) {
      return 0;
    }

    const normalizedWindowStartAt = toNullableDateTime(windowStartAt);
    const normalizedWindowEndAt = toNullableDateTime(windowEndAt);
    if (!normalizedWindowStartAt || !normalizedWindowEndAt) {
      return 0;
    }

    const client = resolveRepoClient(knex, queryOptions);
    const row = await client(tableNames.entitlementConsumptions)
      .where({
        subject_type: normalizeSubjectType(subjectType),
        subject_id: normalizedSubjectId,
        entitlement_definition_id: normalizedDefinitionId
      })
      .andWhere("occurred_at", ">=", normalizedWindowStartAt)
      .andWhere("occurred_at", "<", normalizedWindowEndAt)
      .sum({ total: "amount" })
      .first();

    return Number(row?.total || 0);
  }

  async function recomputeEntitlementBalance(payload = {}, queryOptions = {}) {
    const normalizedSubjectId = toPositiveInteger(payload.subjectId ?? payload.subject_id);
    const normalizedDefinitionId = toPositiveInteger(payload.entitlementDefinitionId ?? payload.entitlement_definition_id);
    if (!normalizedSubjectId || !normalizedDefinitionId) {
      throw new Error("recomputeEntitlementBalance requires subjectId and entitlementDefinitionId.");
    }

    const client = resolveRepoClient(knex, queryOptions);
    const definition = await findEntitlementDefinitionById(normalizedDefinitionId, {
      ...queryOptions,
      trx: client
    });
    if (!definition) {
      throw new Error(`Entitlement definition not found (${normalizedDefinitionId}).`);
    }

    const now = normalizeNow(payload.now, clock);
    const explicitWindowStartAt = normalizeDateInput(payload.windowStartAt ?? payload.window_start_at);
    const explicitWindowEndAt = normalizeDateInput(payload.windowEndAt ?? payload.window_end_at);

    const resolvedWindow =
      explicitWindowStartAt && explicitWindowEndAt
        ? {
            windowStartAt: explicitWindowStartAt,
            windowEndAt: explicitWindowEndAt
          }
        : resolveCalendarWindow(definition.windowInterval, now);

    const grantedAmount = await sumEntitlementGrantAmount(
      {
        subjectType: payload.subjectType ?? payload.subject_type,
        subjectId: normalizedSubjectId,
        entitlementDefinitionId: normalizedDefinitionId,
        now
      },
      {
        ...queryOptions,
        trx: client
      }
    );

    let consumedAmount = 0;
    if (String(definition.entitlementType || "").toLowerCase() === "capacity") {
      if (typeof payload.capacityConsumedAmountResolver === "function") {
        consumedAmount = Number(
          await payload.capacityConsumedAmountResolver({
            subjectType: normalizeSubjectType(payload.subjectType ?? payload.subject_type),
            subjectId: normalizedSubjectId,
            entitlementDefinitionId: normalizedDefinitionId,
            definition,
            now,
            trx: client
          })
        );
      } else if (Number.isFinite(Number(payload.capacityConsumedAmount))) {
        consumedAmount = Number(payload.capacityConsumedAmount);
      } else if (resolveCapacityConsumedAmount) {
        consumedAmount = Number(
          await resolveCapacityConsumedAmount(
            {
              subjectType: normalizeSubjectType(payload.subjectType ?? payload.subject_type),
              subjectId: normalizedSubjectId,
              entitlementDefinitionId: normalizedDefinitionId,
              definition,
              now
            },
            {
              trx: client
            }
          )
        );
      }
    } else {
      consumedAmount = await sumEntitlementConsumptionAmount(
        {
          subjectType: payload.subjectType ?? payload.subject_type,
          subjectId: normalizedSubjectId,
          entitlementDefinitionId: normalizedDefinitionId,
          windowStartAt: resolvedWindow.windowStartAt,
          windowEndAt: resolvedWindow.windowEndAt
        },
        {
          ...queryOptions,
          trx: client
        }
      );
    }

    const safeConsumedAmount = Number.isFinite(consumedAmount) ? Math.max(0, consumedAmount) : 0;
    const effectiveAmount = Number(grantedAmount) - safeConsumedAmount;
    const entitlementType = String(definition.entitlementType || "").toLowerCase();
    const hardLimitAmount = entitlementType === "capacity" || entitlementType === "metered_quota" ? Number(grantedAmount) : null;
    const overLimit = entitlementType === "balance" ? effectiveAmount < 0 : safeConsumedAmount > Number(grantedAmount);

    const lockState =
      toNullableString(
        resolveLockState
          ? resolveLockState({
              definition,
              grantedAmount: Number(grantedAmount),
              consumedAmount: safeConsumedAmount,
              effectiveAmount,
              hardLimitAmount,
              overLimit,
              windowStartAt: resolvedWindow.windowStartAt,
              windowEndAt: resolvedWindow.windowEndAt,
              now
            })
          : "none"
      ) || null;

    const boundaries = await listNextGrantBoundariesForSubjectDefinition(
      {
        subjectType: payload.subjectType ?? payload.subject_type,
        subjectId: normalizedSubjectId,
        entitlementDefinitionId: normalizedDefinitionId,
        now
      },
      {
        ...queryOptions,
        trx: client
      }
    );

    const balance = await upsertEntitlementBalance(
      {
        subjectType: payload.subjectType ?? payload.subject_type,
        subjectId: normalizedSubjectId,
        entitlementDefinitionId: normalizedDefinitionId,
        windowStartAt: resolvedWindow.windowStartAt,
        windowEndAt: resolvedWindow.windowEndAt,
        grantedAmount: Number(grantedAmount),
        consumedAmount: safeConsumedAmount,
        effectiveAmount,
        hardLimitAmount,
        overLimit,
        lockState,
        nextChangeAt: boundaries[0] || null,
        lastRecomputedAt: now,
        metadataJson: {
          definitionCode: definition.code,
          entitlementType: definition.entitlementType
        }
      },
      {
        ...queryOptions,
        trx: client
      }
    );

    return {
      definition,
      balance
    };
  }

  async function leaseDueEntitlementBalances({ now = normalizeNow(null, clock), limit = 100, workerId = "" } = {}, queryOptions = {}) {
    void workerId;
    const client = resolveRepoClient(knex, queryOptions);
    const normalizedLimit = Math.max(1, Math.min(500, Number(limit) || 100));

    const query = client(tableNames.entitlementBalances)
      .whereNotNull("next_change_at")
      .andWhere("next_change_at", "<=", toInsertDateTime(now, normalizeNow(null, clock)))
      .orderBy("next_change_at", "asc")
      .limit(normalizedLimit);

    let rows;
    if (typeof query.forUpdate === "function") {
      const locked = query.forUpdate();
      if (dialectFeatures.skipLocked && typeof locked.skipLocked === "function") {
        rows = await locked.skipLocked();
      } else {
        rows = await locked;
      }
    } else {
      rows = await query;
    }

    return rows.map(mapBalanceRowNullable).filter(Boolean);
  }

  return {
    transaction,
    listEntitlementDefinitions,
    findEntitlementDefinitionByCode,
    findEntitlementDefinitionById,
    insertEntitlementGrant,
    insertEntitlementConsumption,
    findEntitlementBalance,
    upsertEntitlementBalance,
    listEntitlementBalancesForSubject,
    listNextGrantBoundariesForSubjectDefinition,
    sumEntitlementGrantAmount,
    sumEntitlementConsumptionAmount,
    recomputeEntitlementBalance,
    leaseDueEntitlementBalances
  };
}
