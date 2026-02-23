import { ENTITLEMENT_TYPES, toDateOrNull, toNonEmptyString } from "./entities.js";

export const LIFETIME_WINDOW_START = new Date("1970-01-01T00:00:00.000Z");
export const LIFETIME_WINDOW_END = new Date("9999-12-31T23:59:59.999Z");

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
  const referenceDate = toDateOrNull(now) || new Date();
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

function buildConsumptionDedupeKey({
  dedupeKey,
  subjectId,
  entitlementDefinitionId,
  usageEventKey,
  operationKey,
  requestId,
  reasonCode
} = {}) {
  const explicitKey = toNonEmptyString(dedupeKey);
  if (explicitKey) {
    return explicitKey;
  }

  const normalizedSubjectId = Number(subjectId);
  const normalizedDefinitionId = Number(entitlementDefinitionId);
  const normalizedUsageEventKey = toNonEmptyString(usageEventKey);
  const normalizedOperationKey = toNonEmptyString(operationKey);
  const normalizedRequestId = toNonEmptyString(requestId);
  const normalizedReasonCode = toNonEmptyString(reasonCode).toLowerCase() || "usage";

  if (normalizedUsageEventKey) {
    return `usage:${normalizedSubjectId}:${normalizedDefinitionId}:${normalizedUsageEventKey}`;
  }
  if (normalizedOperationKey) {
    return `op:${normalizedSubjectId}:${normalizedDefinitionId}:${normalizedOperationKey}:${normalizedReasonCode}`;
  }
  if (normalizedRequestId) {
    return `req:${normalizedSubjectId}:${normalizedDefinitionId}:${normalizedRequestId}:${normalizedReasonCode}`;
  }
  return "";
}

function resolveHardLimitAmount({ definition, grantedAmount }) {
  const entitlementType = String(definition?.entitlementType || "").trim().toLowerCase();
  if (entitlementType === ENTITLEMENT_TYPES.CAPACITY || entitlementType === ENTITLEMENT_TYPES.METERED_QUOTA) {
    return Number(grantedAmount);
  }
  return null;
}

function resolveOverLimit({ definition, consumedAmount, grantedAmount, effectiveAmount }) {
  const entitlementType = String(definition?.entitlementType || "").trim().toLowerCase();
  if (entitlementType === ENTITLEMENT_TYPES.BALANCE) {
    return Number(effectiveAmount) < 0;
  }
  return Number(consumedAmount) > Number(grantedAmount);
}

function resolveLockState() {
  return "none";
}

export function createEntitlementsPolicy(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};

  return {
    resolveCalendarWindow:
      typeof source.resolveCalendarWindow === "function" ? source.resolveCalendarWindow : resolveCalendarWindow,
    buildConsumptionDedupeKey:
      typeof source.buildConsumptionDedupeKey === "function"
        ? source.buildConsumptionDedupeKey
        : buildConsumptionDedupeKey,
    resolveHardLimitAmount:
      typeof source.resolveHardLimitAmount === "function" ? source.resolveHardLimitAmount : resolveHardLimitAmount,
    resolveOverLimit: typeof source.resolveOverLimit === "function" ? source.resolveOverLimit : resolveOverLimit,
    resolveLockState: typeof source.resolveLockState === "function" ? source.resolveLockState : resolveLockState,
    resolveCapacityConsumedAmount:
      typeof source.resolveCapacityConsumedAmount === "function" ? source.resolveCapacityConsumedAmount : null
  };
}

export { addUtcDays, resolveCalendarWindow };
