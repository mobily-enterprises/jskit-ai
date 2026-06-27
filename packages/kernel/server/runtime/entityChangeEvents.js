import { isContainerToken } from "../../shared/support/containerToken.js";
import { normalizeObject, normalizeOpaqueId, normalizeText } from "../../shared/support/normalize.js";
import { resolveServiceContext } from "./serviceAuthorization.js";

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

function resolveVisibilityScope(visibilityContext = {}, runtimeContext = {}) {
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

function resolveDefaultScope(visibilityContext = {}, runtime = {}) {
  const runtimeContext = normalizeObject(runtime?.context);

  const visibilityScope = resolveVisibilityScope(visibilityContext, runtimeContext);
  if (visibilityScope) {
    return visibilityScope;
  }

  const contextScope = resolveContextScope(runtimeContext);
  if (contextScope) {
    return contextScope;
  }

  return {
    kind: "global",
    id: null
  };
}

function resolveCommandId(requestMeta = {}) {
  return normalizeText(requestMeta.commandId || requestMeta.idempotencyKey || "") || null;
}

function resolveSourceClientId(requestMeta = {}) {
  return normalizeText(requestMeta.sourceClientId) || null;
}

function createEntityChangePublisher({
  domainEvents,
  source,
  entity,
  scopeResolver = resolveDefaultScope
} = {}) {
  if (!domainEvents || typeof domainEvents.publish !== "function") {
    throw new TypeError("createEntityChangePublisher requires domainEvents.publish().");
  }

  const normalizedSource = normalizeText(source);
  if (!normalizedSource) {
    throw new TypeError("createEntityChangePublisher requires source.");
  }

  const normalizedEntity = normalizeText(entity);
  if (!normalizedEntity) {
    throw new TypeError("createEntityChangePublisher requires entity.");
  }

  return async function publishEntityChange(operation, entityId, options = {}, meta = null) {
    const normalizedOperation = normalizeText(operation).toLowerCase();
    if (!ENTITY_CHANGE_OPERATIONS.has(normalizedOperation)) {
      throw new TypeError("publishEntityChange operation must be one of: created, updated, deleted.");
    }

    const normalizedEntityId = normalizeOpaqueId(entityId);
    if (normalizedEntityId == null) {
      return null;
    }

    const context = resolveServiceContext(options);
    const requestMeta = normalizeObject(context.requestMeta);
    const visibilityContext = normalizeObject(options.visibilityContext || context.visibilityContext);
    const scope = scopeResolver(visibilityContext, {
      context,
      options
    });

    const payload = {
      source: normalizedSource,
      entity: normalizedEntity,
      operation: normalizedOperation,
      entityId: normalizedEntityId,
      scope: scope && typeof scope === "object" ? scope : resolveDefaultScope(visibilityContext),
      actorId: normalizeOpaqueId(context?.actor?.id),
      commandId: resolveCommandId(requestMeta),
      sourceClientId: resolveSourceClientId(requestMeta),
      occurredAt: new Date().toISOString()
    };
    const normalizedMeta = normalizeObject(meta);
    if (Object.keys(normalizedMeta).length > 0) {
      payload.meta = normalizedMeta;
    }

    await domainEvents.publish(payload);
    return payload;
  };
}

function normalizeMetaTextField(source = {}, fieldName = "", { context = "realtime entity change" } = {}) {
  if (!Object.hasOwn(source, fieldName)) {
    return "";
  }

  const value = source[fieldName];
  if (value == null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new TypeError(`${context}.${fieldName} must be a non-empty string.`);
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    throw new TypeError(`${context}.${fieldName} must be a non-empty string.`);
  }
  return normalized;
}

function normalizeRealtimePayload(value, { context = "realtime entity change.payload" } = {}) {
  if (value == null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object.`);
  }
  return Object.freeze({
    ...value
  });
}

function createRealtimeEntityChangeMeta({
  serviceToken,
  methodName,
  event,
  change = {}
} = {}) {
  const source = normalizeObject(change);
  const baseMeta = normalizeObject(source.meta);
  const meta = {
    ...baseMeta,
    service: Object.freeze({
      token: serviceToken,
      method: methodName
    })
  };

  const action = normalizeMetaTextField(source, "action");
  if (action) {
    meta.action = action;
  }

  const reason = normalizeMetaTextField(source, "reason");
  if (reason) {
    meta.reason = reason;
  }

  const realtimeSource = normalizeObject(source.realtime);
  const payloadSource = Object.hasOwn(source, "payload") ? source.payload : realtimeSource.payload;
  const payload = normalizeRealtimePayload(payloadSource);
  meta.realtime = payload
    ? Object.freeze({
        event,
        payload
      })
    : Object.freeze({
        event
      });

  return Object.freeze(meta);
}

function resolveRealtimeEntityChangeOptions(change = {}, options = {}) {
  const source = normalizeObject(change);
  if (Object.hasOwn(source, "options")) {
    return normalizeObject(source.options);
  }
  return normalizeObject(options);
}

function createRealtimeEntityChangePublisher({
  domainEvents,
  source,
  entity,
  event,
  serviceToken,
  methodName,
  scopeResolver = resolveDefaultScope
} = {}) {
  const normalizedEvent = normalizeText(event);
  if (!normalizedEvent) {
    throw new TypeError("createRealtimeEntityChangePublisher requires event.");
  }

  if (!isContainerToken(serviceToken)) {
    throw new TypeError("createRealtimeEntityChangePublisher requires a valid serviceToken.");
  }

  const normalizedMethodName = normalizeText(methodName);
  if (!normalizedMethodName) {
    throw new TypeError("createRealtimeEntityChangePublisher requires methodName.");
  }

  const publishEntityChange = createEntityChangePublisher({
    domainEvents,
    source,
    entity,
    scopeResolver
  });

  return async function publishRealtimeEntityChange(operation, entityId, change = {}, options = {}) {
    const runtimeOptions = resolveRealtimeEntityChangeOptions(change, options);
    const meta = createRealtimeEntityChangeMeta({
      serviceToken,
      methodName: normalizedMethodName,
      event: normalizedEvent,
      change
    });
    return publishEntityChange(operation, entityId, runtimeOptions, meta);
  };
}

function createNoopEntityChangePublisher() {
  return async function publishEntityChange() {
    return null;
  };
}

export {
  resolveDefaultScope,
  createEntityChangePublisher,
  createRealtimeEntityChangePublisher,
  createNoopEntityChangePublisher
};
