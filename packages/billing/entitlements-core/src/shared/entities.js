import {
  normalizeAmountAllowZero,
  normalizeAmountRequireNonZero,
  normalizeAmountRequirePositive
} from "@jskit-ai/billing-core";

export const ENTITLEMENT_TYPES = {
  CAPACITY: "capacity",
  METERED_QUOTA: "metered_quota",
  BALANCE: "balance",
  STATE: "state"
};

const SUPPORTED_ENTITLEMENT_TYPES = new Set(Object.values(ENTITLEMENT_TYPES));

export const DEFAULT_SUBJECT_TYPE = "billable_entity";

export function toNonEmptyString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

export function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

export function toInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
}

export function normalizeEntitlementType(value, fallback = ENTITLEMENT_TYPES.BALANCE) {
  const normalized = toNonEmptyString(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return SUPPORTED_ENTITLEMENT_TYPES.has(normalized) ? normalized : fallback;
}

export function normalizeSubjectType(value, fallback = DEFAULT_SUBJECT_TYPE) {
  const normalized = toNonEmptyString(value).toLowerCase();
  return normalized || fallback;
}

export function toDateOrNull(value) {
  if (!value) {
    return null;
  }

  const candidate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(candidate.getTime())) {
    return null;
  }
  return candidate;
}

export function normalizeCodes(value) {
  if (!Array.isArray(value) || value.length < 1) {
    return null;
  }

  const normalized = value.map((entry) => toNonEmptyString(entry)).filter(Boolean);
  if (normalized.length < 1) {
    return null;
  }

  return [...new Set(normalized)];
}

export { normalizeAmountAllowZero, normalizeAmountRequireNonZero, normalizeAmountRequirePositive };

export function normalizeAmount(value, { allowNegative = false, requireNonZero = true } = {}) {
  if (requireNonZero) {
    return normalizeAmountRequireNonZero(value, { allowNegative });
  }

  return normalizeAmountAllowZero(value, { allowNegative });
}

export function normalizeBalanceRow(row) {
  if (!row || typeof row !== "object") {
    return null;
  }

  return {
    id: toPositiveInteger(row.id),
    subjectType: normalizeSubjectType(row.subjectType || row.subject_type),
    subjectId: toPositiveInteger(row.subjectId || row.subject_id),
    entitlementDefinitionId: toPositiveInteger(row.entitlementDefinitionId || row.entitlement_definition_id),
    windowStartAt: toDateOrNull(row.windowStartAt || row.window_start_at)?.toISOString() || null,
    windowEndAt: toDateOrNull(row.windowEndAt || row.window_end_at)?.toISOString() || null,
    grantedAmount: Number(row.grantedAmount || row.granted_amount || 0),
    consumedAmount: Number(row.consumedAmount || row.consumed_amount || 0),
    effectiveAmount: Number(row.effectiveAmount || row.effective_amount || 0),
    hardLimitAmount:
      row.hardLimitAmount == null && row.hard_limit_amount == null ? null : Number(row.hardLimitAmount ?? row.hard_limit_amount),
    overLimit: Boolean(row.overLimit ?? row.over_limit),
    lockState: toNonEmptyString(row.lockState ?? row.lock_state) || null,
    nextChangeAt: toDateOrNull(row.nextChangeAt || row.next_change_at)?.toISOString() || null,
    lastRecomputedAt: toDateOrNull(row.lastRecomputedAt || row.last_recomputed_at)?.toISOString() || null,
    metadataJson: row.metadataJson ?? row.metadata_json ?? null
  };
}
