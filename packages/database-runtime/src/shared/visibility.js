import { normalizeVisibilityContext } from "@jskit-ai/kernel/shared/support/visibility";

const ALWAYS_FALSE_SQL = "1 = 0";
const DEFAULT_VISIBILITY_COLUMNS = Object.freeze({
  scopeOwnerId: "workspace_id",
  userId: "user_id"
});

function applyVisibility(queryBuilder, visibilityContext = {}) {
  const context = normalizeVisibilityContext(visibilityContext);
  const workspaceColumn = DEFAULT_VISIBILITY_COLUMNS.scopeOwnerId;
  const userColumn = DEFAULT_VISIBILITY_COLUMNS.userId;

  if (context.visibility === "public") {
    return queryBuilder;
  }

  if (context.visibility === "workspace") {
    if (!context.scopeOwnerId) {
      return queryBuilder.whereRaw(ALWAYS_FALSE_SQL);
    }
    return queryBuilder.where(workspaceColumn, context.scopeOwnerId);
  }

  if (context.visibility === "user") {
    if (!context.userId) {
      return queryBuilder.whereRaw(ALWAYS_FALSE_SQL);
    }
    return queryBuilder.where(userColumn, context.userId);
  }

  if (!context.scopeOwnerId || !context.userId) {
    return queryBuilder.whereRaw(ALWAYS_FALSE_SQL);
  }

  return queryBuilder.where(workspaceColumn, context.scopeOwnerId).where(userColumn, context.userId);
}

function applyVisibilityOwners(payload = {}, visibilityContext = {}) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const context = normalizeVisibilityContext(visibilityContext);

  if (context.visibility === "public") {
    return {
      ...source
    };
  }

  if (context.visibility === "workspace" && !context.scopeOwnerId) {
    throw new Error("Visibility context requires scopeOwnerId.");
  }
  if (context.visibility === "user" && !context.userId) {
    throw new Error("Visibility context requires userId.");
  }
  if (context.visibility === "workspace_user" && (!context.scopeOwnerId || !context.userId)) {
    throw new Error("Visibility context requires scopeOwnerId and userId.");
  }

  const ownedPayload = {
    ...source
  };

  if (context.scopeOwnerId) {
    ownedPayload.workspace_id = context.scopeOwnerId;
  }
  if (context.userId) {
    ownedPayload.user_id = context.userId;
  }

  return ownedPayload;
}

export { DEFAULT_VISIBILITY_COLUMNS, applyVisibility, applyVisibilityOwners };
