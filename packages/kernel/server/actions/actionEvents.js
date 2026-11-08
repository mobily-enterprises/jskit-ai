import {
  normalizeObject,
  normalizeOpaqueId,
  normalizeText,
  isRecord
} from "../../shared/support/normalize.js";
import { resolveActorId, resolveRequest } from "./actionContributorHelpers.js";

const ENTITY_CHANGE_OPERATIONS = new Set(["created", "updated", "deleted"]);

function resolveContextScope(context = {}) {
  const sourceScope = normalizeObject(context.scope || context.requestMeta?.scope);
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

/**
 * The workspace the execution's request resolved, as the framework set it on the context (the context's workspace,
 * the resolved workspace context, the request's workspace), never from input or payload; null when none is set or
 * they disagree.
 * @param {object} context
 */
function resolveRequestWorkspaceId(context) {
  const ids = [
    context.workspace?.id,
    context.requestMeta?.resolvedWorkspaceContext?.workspace?.id,
    resolveRequest(context)?.workspace?.id
  ].map((id) => normalizeOpaqueId(id)).filter((id) => id != null);
  return ids.length > 0 && ids.every((id) => id === ids[0]) ? ids[0] : null;
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

  // A customer's or a public surface's write reaches no room by its scope, but its audience reads in the workspace
  // it ran in (realtime's audienceUsers), which only the framework names.
  const workspaceId = resolveRequestWorkspaceId(context);
  return {
    kind: "global",
    id: null,
    ...(workspaceId == null ? {} : { workspaceId })
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
  if (payload != null && !isRecord(payload)) {
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
 * action's execution ({ definition, input, result, context }). The builder
 * carries the realtime part it was declared with as `realtime`, so realtime can
 * check an audience it is given as it is (not as a function) when it boots.
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

  function buildEntityChangedEvent(execution = {}) {
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
      actorId: resolveActorId(context),
      commandId: normalizeText(requestMeta.commandId) || null,
      sourceClientId: normalizeText(requestMeta.sourceClientId) || null,
      occurredAt: new Date().toISOString(),
      ...(realtimeMeta ? { realtime: realtimeMeta } : {})
    });
  }
  return Object.defineProperty(buildEntityChangedEvent, "realtime", { value: realtime, enumerable: true });
}

export { createEntityChangedActionEvent };
