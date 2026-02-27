const DEFAULT_REALTIME_EVENT_TYPES = Object.freeze({
  WORKSPACE_BILLING_LIMITS_UPDATED: "workspace.billing.limits.updated"
});

const DEFAULT_REALTIME_TOPICS = Object.freeze({
  WORKSPACE_BILLING_LIMITS: "workspace_billing_limits"
});

const BILLING_LIMIT_CHANGE_SOURCES = new Set([
  "purchase_grant",
  "plan_grant",
  "consumption",
  "boundary_recompute",
  "manual_refresh"
]);

function normalizeChangeSource(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (BILLING_LIMIT_CHANGE_SOURCES.has(normalized)) {
    return normalized;
  }
  return "manual_refresh";
}

function normalizeChangedCodes(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))];
}

function normalizeOptionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizePositiveIntegerOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function toIsoOrNow(value) {
  const normalized = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(normalized.getTime())) {
    return new Date().toISOString();
  }
  return normalized.toISOString();
}

function createService({ billingRepository, realtimeEventsService, realtimeEventTypes, realtimeTopics } = {}) {
  const resolvedRealtimeEventTypes =
    realtimeEventTypes && typeof realtimeEventTypes === "object"
      ? {
          ...DEFAULT_REALTIME_EVENT_TYPES,
          ...realtimeEventTypes
        }
      : DEFAULT_REALTIME_EVENT_TYPES;
  const resolvedRealtimeTopics =
    realtimeTopics && typeof realtimeTopics === "object"
      ? {
          ...DEFAULT_REALTIME_TOPICS,
          ...realtimeTopics
        }
      : DEFAULT_REALTIME_TOPICS;

  async function publishWorkspaceBillingLimitsUpdated({
    billableEntityId,
    changedCodes = [],
    changeSource = "manual_refresh",
    changedAt = new Date(),
    commandId = null,
    sourceClientId = null,
    actorUserId = null
  } = {}) {
    if (!billingRepository || typeof billingRepository.findWorkspaceContextForBillableEntity !== "function") {
      return null;
    }
    if (!realtimeEventsService || typeof realtimeEventsService.publishWorkspaceEvent !== "function") {
      return null;
    }

    const normalizedBillableEntityId = normalizePositiveIntegerOrNull(billableEntityId);
    if (!normalizedBillableEntityId) {
      return null;
    }

    const workspaceContext = await billingRepository.findWorkspaceContextForBillableEntity(normalizedBillableEntityId);
    const workspaceId = normalizePositiveIntegerOrNull(workspaceContext?.workspaceId);
    const workspaceSlug = normalizeOptionalString(workspaceContext?.workspaceSlug);
    if (!workspaceId || !workspaceSlug) {
      return null;
    }

    return realtimeEventsService.publishWorkspaceEvent({
      eventType: resolvedRealtimeEventTypes.WORKSPACE_BILLING_LIMITS_UPDATED,
      topic: resolvedRealtimeTopics.WORKSPACE_BILLING_LIMITS,
      workspace: {
        id: workspaceId,
        slug: workspaceSlug
      },
      entityType: "billable_entity",
      entityId: normalizedBillableEntityId,
      commandId: normalizeOptionalString(commandId),
      sourceClientId: normalizeOptionalString(sourceClientId),
      actorUserId: normalizePositiveIntegerOrNull(actorUserId),
      payload: {
        workspaceId,
        workspaceSlug,
        changedCodes: normalizeChangedCodes(changedCodes),
        changeSource: normalizeChangeSource(changeSource),
        changedAt: toIsoOrNow(changedAt)
      }
    });
  }

  return {
    publishWorkspaceBillingLimitsUpdated
  };
}

const __testables = {
  BILLING_LIMIT_CHANGE_SOURCES,
  normalizeChangeSource,
  normalizeChangedCodes
};

export { createService, __testables };
