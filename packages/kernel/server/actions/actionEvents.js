import { resolveDefaultScope } from "../runtime/entityChangeEvents.js";
import { normalizeObject, normalizeOpaqueId, normalizeText } from "../../shared/support/normalize.js";

const ENTITY_CHANGE_OPERATIONS = new Set(["created", "updated", "deleted"]);

function resolveValue(value, execution) {
  return typeof value === "function" ? value(execution) : value;
}

function normalizeRealtime(value, execution) {
  const source = normalizeObject(value);
  if (Object.keys(source).length === 0) return null;
  const event = normalizeText(source.event);
  if (!event) throw new TypeError("Action entity-change realtime.event is required.");
  const audience = resolveValue(source.audience ?? "event_scope", execution);
  const payload = resolveValue(source.payload, execution);
  if (payload != null && (!payload || typeof payload !== "object" || Array.isArray(payload))) {
    throw new TypeError("Action entity-change realtime.payload must resolve to an object.");
  }
  return Object.freeze({
    event,
    audience,
    ...(payload == null ? {} : { payload: Object.freeze({ ...payload }) })
  });
}

function createEntityChangedActionEvent({
  source,
  entity,
  operation,
  entityId,
  realtime = null
} = {}) {
  const normalizedSource = normalizeText(source);
  const normalizedEntity = normalizeText(entity);
  if (!normalizedSource) throw new TypeError("Action entity-change source is required.");
  if (!normalizedEntity) throw new TypeError("Action entity-change entity is required.");

  return function buildEntityChangedEvent(execution = {}) {
    const normalizedOperation = normalizeText(resolveValue(operation, execution)).toLowerCase();
    if (!ENTITY_CHANGE_OPERATIONS.has(normalizedOperation)) {
      throw new TypeError("Action entity-change operation must resolve to created, updated, or deleted.");
    }
    const normalizedEntityId = normalizeOpaqueId(resolveValue(entityId, execution));
    if (normalizedEntityId == null) return null;

    const context = normalizeObject(execution.context);
    const requestMeta = normalizeObject(context.requestMeta);
    const realtimeMeta = normalizeRealtime(realtime, execution);
    return Object.freeze({
      type: "entity.changed",
      source: normalizedSource,
      entity: normalizedEntity,
      operation: normalizedOperation,
      entityId: normalizedEntityId,
      scope: resolveDefaultScope(normalizeObject(context.visibilityContext), { context }),
      actorId: normalizeOpaqueId(context?.actor?.id),
      commandId: normalizeText(requestMeta.commandId || requestMeta.idempotencyKey) || null,
      sourceClientId: normalizeText(requestMeta.sourceClientId) || null,
      occurredAt: new Date().toISOString(),
      ...(realtimeMeta ? { realtime: realtimeMeta } : {})
    });
  };
}

export { createEntityChangedActionEvent };
