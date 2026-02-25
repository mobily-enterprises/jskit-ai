function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeHeaderValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

function resolveCommandId(context, input) {
  const payload = normalizeObject(input);
  const requestMeta = normalizeObject(payload.requestMeta);
  return (
    normalizeHeaderValue(requestMeta.commandId) ||
    normalizeHeaderValue(requestMeta.idempotencyKey) ||
    normalizeHeaderValue(payload.commandId) ||
    normalizeHeaderValue(payload.idempotencyKey) ||
    normalizeHeaderValue(context?.requestMeta?.commandId) ||
    normalizeHeaderValue(context?.requestMeta?.idempotencyKey) ||
    normalizeHeaderValue(resolveRequest(context)?.headers?.["x-command-id"]) ||
    null
  );
}

function resolveSourceClientId(context, input) {
  const payload = normalizeObject(input);
  const requestMeta = normalizeObject(payload.requestMeta);
  return (
    normalizeHeaderValue(requestMeta.sourceClientId) ||
    normalizeHeaderValue(payload.sourceClientId) ||
    normalizeHeaderValue(context?.requestMeta?.sourceClientId) ||
    normalizeHeaderValue(resolveRequest(context)?.headers?.["x-client-id"]) ||
    null
  );
}

function resolveActorUserId(context, input) {
  const payload = normalizeObject(input);
  const payloadUser = payload.user && typeof payload.user === "object" ? payload.user : null;
  const requestUser = resolveRequest(context)?.user;
  const actor = context?.actor;
  return (
    toPositiveInteger(payloadUser?.id) ||
    toPositiveInteger(requestUser?.id) ||
    toPositiveInteger(actor?.id) ||
    0
  );
}

function resolveWorkspaceContext(context, input) {
  const payload = normalizeObject(input);
  const payloadWorkspace = payload.workspace && typeof payload.workspace === "object" ? payload.workspace : null;
  const requestWorkspace = resolveRequest(context)?.workspace;
  const contextWorkspace = context?.workspace;
  const source = payloadWorkspace || requestWorkspace || contextWorkspace || null;

  if (!source) {
    return null;
  }

  return {
    id: toPositiveInteger(source.id) || null,
    slug: normalizeHeaderValue(source.slug) || null
  };
}

function resolveRealtimePublish(realtimeEventsService) {
  if (!realtimeEventsService || typeof realtimeEventsService.publish !== "function") {
    return null;
  }

  return realtimeEventsService.publish.bind(realtimeEventsService);
}

function resolveRealtimeCreateEventEnvelope(realtimeEventsService) {
  if (!realtimeEventsService || typeof realtimeEventsService.createEventEnvelope !== "function") {
    return null;
  }

  return realtimeEventsService.createEventEnvelope.bind(realtimeEventsService);
}

function publishUserScopedRealtimeEvent({
  realtimeEventsService,
  context,
  input,
  topic,
  eventType,
  entityType,
  entityId,
  payload = {},
  workspace = null,
  targetUserId = null
} = {}) {
  const publish = resolveRealtimePublish(realtimeEventsService);
  if (!publish) {
    return false;
  }

  const actorUserId = toPositiveInteger(targetUserId) || resolveActorUserId(context, input);
  if (!actorUserId) {
    return false;
  }

  const workspaceContext =
    workspace && typeof workspace === "object" ? workspace : resolveWorkspaceContext(context, input) || null;
  const createEventEnvelope = resolveRealtimeCreateEventEnvelope(realtimeEventsService);
  const envelopeInput = {
    eventType,
    topic,
    entityType: String(entityType || "user"),
    entityId: entityId == null ? "none" : String(entityId),
    commandId: resolveCommandId(context, input),
    sourceClientId: resolveSourceClientId(context, input),
    actorUserId,
    payload
  };

  if (workspaceContext) {
    envelopeInput.workspaceId = workspaceContext.id || null;
    envelopeInput.workspaceSlug = workspaceContext.slug || null;
  }

  const envelope = createEventEnvelope
    ? {
        ...createEventEnvelope(envelopeInput),
        targetUserIds: [actorUserId]
      }
    : {
        ...envelopeInput,
        targetUserIds: [actorUserId]
      };

  try {
    publish(envelope);
    return true;
  } catch {
    return false;
  }
}

export {
  normalizeObject,
  toPositiveInteger,
  resolveRequest,
  resolveActorUserId,
  resolveWorkspaceContext,
  publishUserScopedRealtimeEvent
};
