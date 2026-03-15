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

function resolveContextWorkspaceOwnerId(context = {}) {
  const workspace =
    context?.workspace || context?.requestMeta?.resolvedWorkspaceContext?.workspace || context?.request?.workspace;
  return toPositiveInteger(workspace?.id);
}

function resolveContextUserOwnerId(context = {}) {
  const actor = context?.actor || context?.user || context?.request?.user;
  return toPositiveInteger(actor?.id);
}

function resolveDefaultScope(visibilityContext = {}, runtime = {}) {
  const runtimeContext = normalizeObject(runtime?.context);
  const workspaceOwnerId = toPositiveInteger(visibilityContext.workspaceOwnerId);
  if (workspaceOwnerId > 0 || resolveContextWorkspaceOwnerId(runtimeContext) > 0) {
    return {
      kind: "workspace",
      id: workspaceOwnerId > 0 ? workspaceOwnerId : resolveContextWorkspaceOwnerId(runtimeContext)
    };
  }

  const userOwnerId = toPositiveInteger(visibilityContext.userOwnerId);
  if (userOwnerId > 0 || resolveContextUserOwnerId(runtimeContext) > 0) {
    return {
      kind: "user",
      id: userOwnerId > 0 ? userOwnerId : resolveContextUserOwnerId(runtimeContext)
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
