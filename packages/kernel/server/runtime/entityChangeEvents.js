import { normalizeObject, normalizeText } from "../../shared/support/normalize.js";
import { resolveServiceContext } from "./serviceAuthorization.js";

const ENTITY_CHANGE_OPERATIONS = new Set(["created", "updated", "deleted"]);

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function resolveContextUserOwnerId(context = {}) {
  const actor = context?.actor || context?.user || context?.request?.user;
  return toPositiveInteger(actor?.id);
}

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

  const scopeId = toPositiveInteger(sourceScope.id);
  if (scopeId < 1) {
    return null;
  }

  const resolvedScope = {
    kind,
    id: scopeId
  };

  const scopeUserId = toPositiveInteger(sourceScope.userId);
  if (scopeUserId > 0) {
    resolvedScope.userId = scopeUserId;
  }

  const scopedScopeId = toPositiveInteger(sourceScope.scopeId);
  if (scopedScopeId > 0) {
    resolvedScope.scopeId = scopedScopeId;
  }

  return resolvedScope;
}

function resolveVisibilityScope(visibilityContext = {}, runtimeContext = {}) {
  const visibility = normalizeText(visibilityContext.visibility).toLowerCase();
  const scopeKind = normalizeText(visibilityContext.scopeKind || visibility).toLowerCase();
  const scopeOwnerId = toPositiveInteger(visibilityContext.scopeOwnerId);
  const userOwnerId = toPositiveInteger(visibilityContext.userOwnerId) || resolveContextUserOwnerId(runtimeContext);

  const requiresScopedUser = scopeKind.endsWith("_user");
  if (requiresScopedUser && userOwnerId < 1) {
    return null;
  }

  if (scopeKind && scopeOwnerId > 0) {
    const scope = {
      kind: scopeKind,
      id: scopeOwnerId
    };
    if (requiresScopedUser) {
      scope.scopeId = scopeOwnerId;
      scope.userId = userOwnerId;
    }
    return scope;
  }
  if (scopeKind && scopeKind !== "user") {
    return null;
  }

  if (!scopeKind && scopeOwnerId > 0) {
    return {
      kind: "scope",
      id: scopeOwnerId
    };
  }

  if (userOwnerId > 0) {
    return {
      kind: "user",
      id: userOwnerId
    };
  }

  if (userOwnerId > 0) {
    return {
      kind: "user",
      id: userOwnerId
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

  const userOwnerId = resolveContextUserOwnerId(runtimeContext);
  if (userOwnerId > 0) {
    return {
      kind: "user",
      id: userOwnerId
    };
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

    const normalizedEntityId = toPositiveInteger(entityId);
    if (normalizedEntityId < 1) {
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
      actorId: toPositiveInteger(context?.actor?.id) || null,
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

function createNoopEntityChangePublisher() {
  return async function publishEntityChange() {
    return null;
  };
}

export {
  resolveDefaultScope,
  createEntityChangePublisher,
  createNoopEntityChangePublisher
};
