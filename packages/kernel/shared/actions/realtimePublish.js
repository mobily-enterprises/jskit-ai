import { normalizeObject } from "../support/normalize.js";

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
    normalizeHeaderValue(context?.requestMeta?.request?.headers?.["x-command-id"]) ||
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
    normalizeHeaderValue(context?.requestMeta?.request?.headers?.["x-client-id"]) ||
    null
  );
}

function publishRealtimeCommandEvent({
  realtimeEventsService,
  actionId,
  input,
  context,
  actorUserId,
  publishConfig,
  resolvePayload,
  resolveEntityType,
  resolveEntityId
} = {}) {
  if (!realtimeEventsService || typeof realtimeEventsService.publish !== "function") {
    return false;
  }
  if (!publishConfig?.topic || !publishConfig?.eventType) {
    return false;
  }

  const normalizedActorUserId = toPositiveInteger(actorUserId);
  if (!normalizedActorUserId) {
    return false;
  }

  const envelopeInput = {
    eventType: String(publishConfig.eventType || ""),
    topic: String(publishConfig.topic || ""),
    entityType:
      typeof resolveEntityType === "function"
        ? String(resolveEntityType({ actionId, input, context }) || "command")
        : "command",
    entityId:
      typeof resolveEntityId === "function"
        ? String(resolveEntityId({ actionId, input, context }) || String(actionId || "none"))
        : String(actionId || "none"),
    commandId: resolveCommandId(context, input),
    sourceClientId: resolveSourceClientId(context, input),
    actorUserId: normalizedActorUserId,
    payload:
      typeof resolvePayload === "function"
        ? normalizeObject(resolvePayload({ actionId, input, context }))
        : {
            actionId: String(actionId || "")
          }
  };

  const createEventEnvelope =
    typeof realtimeEventsService.createEventEnvelope === "function"
      ? realtimeEventsService.createEventEnvelope.bind(realtimeEventsService)
      : null;

  const eventEnvelope = createEventEnvelope
    ? {
        ...createEventEnvelope(envelopeInput),
        targetUserIds: [normalizedActorUserId]
      }
    : {
        ...envelopeInput,
        targetUserIds: [normalizedActorUserId]
      };

  try {
    realtimeEventsService.publish(eventEnvelope);
    return true;
  } catch {
    return false;
  }
}

function applyRealtimePublishToCommandAction(action, {
  realtimeEventsService,
  resolvePublishConfig,
  resolveActorUserId,
  resolvePayload,
  resolveEntityType,
  resolveEntityId
} = {}) {
  const definition = action && typeof action === "object" ? action : null;
  if (!definition || definition.kind !== "command" || typeof definition.execute !== "function") {
    return definition;
  }

  const publishConfig =
    typeof resolvePublishConfig === "function" ? resolvePublishConfig(String(definition.id || "")) : null;
  if (!publishConfig?.topic || !publishConfig?.eventType) {
    return definition;
  }

  const baseExecute = definition.execute;
  return {
    ...definition,
    async execute(input, context) {
      const result = await baseExecute(input, context);
      const actorUserId =
        typeof resolveActorUserId === "function"
          ? resolveActorUserId({ actionId: definition.id, input, context, result })
          : 0;

      publishRealtimeCommandEvent({
        realtimeEventsService,
        actionId: definition.id,
        input,
        context,
        actorUserId,
        publishConfig,
        resolvePayload,
        resolveEntityType,
        resolveEntityId
      });

      return result;
    }
  };
}

export {
  normalizeObject,
  normalizeHeaderValue,
  toPositiveInteger,
  resolveCommandId,
  resolveSourceClientId,
  publishRealtimeCommandEvent,
  applyRealtimePublishToCommandAction
};
