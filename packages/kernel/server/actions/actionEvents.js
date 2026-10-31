import { normalizeObject, normalizeOpaqueId, normalizeText } from "../../shared/support/normalize.js";

const ENTITY_CHANGE_OPERATIONS = new Set(["created", "updated", "deleted"]);

function resolveContextScope(context = {}) {
  const sourceScope = normalizeObject(context?.scope || context?.requestMeta?.scope || context?.request?.scope);
  const kind = normalizeText(sourceScope.kind).toLowerCase();
  if (!kind) {
    return null;
  }
  if (kind === "global") {
    return {
      kind: "global",
      id: null
    };
  }

  const scopeId = normalizeOpaqueId(sourceScope.id);
  if (scopeId == null) {
    return null;
  }

  const resolvedScope = {
    kind,
    id: scopeId
  };

  const scopeUserId = normalizeOpaqueId(sourceScope.userId);
  if (scopeUserId != null) {
    resolvedScope.userId = scopeUserId;
  }

  const scopedScopeId = normalizeOpaqueId(sourceScope.scopeId);
  if (scopedScopeId != null) {
    resolvedScope.scopeId = scopedScopeId;
  }

  return resolvedScope;
}

function resolveVisibilityScope(visibilityContext = {}) {
  const visibility = normalizeText(visibilityContext.visibility).toLowerCase();
  const scopeKind = normalizeText(visibilityContext.scopeKind || visibility).toLowerCase();
  const scopeOwnerId = normalizeOpaqueId(visibilityContext.scopeOwnerId);
  const userId = normalizeOpaqueId(visibilityContext.userId);
  const requiresActorScope = visibilityContext.requiresActorScope === true;

  if (requiresActorScope && userId == null) {
    return null;
  }

  if (scopeKind && scopeOwnerId != null) {
    const scope = {
      kind: scopeKind,
      id: scopeOwnerId
    };
    if (requiresActorScope) {
      scope.scopeId = scopeOwnerId;
      scope.userId = userId;
    }
    return scope;
  }
  if (scopeKind && scopeKind !== "user") {
    return null;
  }

  if (!scopeKind && scopeOwnerId != null) {
    return {
      kind: "scope",
      id: scopeOwnerId
    };
  }

  if (scopeKind === "user" && userId != null) {
    return {
      kind: "user",
      id: userId
    };
  }

  return null;
}

function resolveEventScope(context = {}) {
  const visibilityScope = resolveVisibilityScope(normalizeObject(context.visibilityContext));
  if (visibilityScope) {
    return visibilityScope;
  }

  const contextScope = resolveContextScope(context);
  if (contextScope) {
    return contextScope;
  }

  return {
    kind: "global",
    id: null
  };
}

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

/**
 * An action event builder: once the action has run, it announces that one of
 * the source's entities was created, updated or deleted. operation, entityId
 * and the realtime audience and payload may each be a function of the
 * action's execution ({ definition, input, result, context }).
 * @param {object} change
 * @param {string} change.source The package or domain that announces the change.
 * @param {string} change.entity
 * @param {string | ((execution: any) => string)} change.operation "created", "updated" or "deleted".
 * @param {unknown} change.entityId
 * @param {{ event: string, audience?: unknown, payload?: unknown } | null} [change.realtime]
 */
function createEntityChangedActionEvent({
  source,
  entity,
  operation,
  entityId,
  realtime = null
}) {
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
      scope: resolveEventScope(context),
      actorId: normalizeOpaqueId(context?.actor?.id),
      commandId: normalizeText(requestMeta.commandId || requestMeta.idempotencyKey) || null,
      sourceClientId: normalizeText(requestMeta.sourceClientId) || null,
      occurredAt: new Date().toISOString(),
      ...(realtimeMeta ? { realtime: realtimeMeta } : {})
    });
  };
}

export { createEntityChangedActionEvent };
