import { normalizeVisibilityContext } from "@jskit-ai/kernel/shared/support/visibility";

const ALWAYS_FALSE_SQL = "1 = 0";
const DEFAULT_VISIBILITY_COLUMNS = Object.freeze({
  scopeOwnerId: "workspace_owner_id",
  userOwnerId: "user_owner_id"
});

function applyVisibility(queryBuilder, visibilityContext = {}) {
  const context = normalizeVisibilityContext(visibilityContext);
  const workspaceColumn = DEFAULT_VISIBILITY_COLUMNS.scopeOwnerId;
  const userColumn = DEFAULT_VISIBILITY_COLUMNS.userOwnerId;

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
    if (!context.userOwnerId) {
      return queryBuilder.whereRaw(ALWAYS_FALSE_SQL);
    }
    return queryBuilder.where(userColumn, context.userOwnerId);
  }

  if (!context.scopeOwnerId || !context.userOwnerId) {
    return queryBuilder.whereRaw(ALWAYS_FALSE_SQL);
  }

  return queryBuilder.where(workspaceColumn, context.scopeOwnerId).where(userColumn, context.userOwnerId);
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
  if (context.visibility === "user" && !context.userOwnerId) {
    throw new Error("Visibility context requires userOwnerId.");
  }
  if (context.visibility === "workspace_user" && (!context.scopeOwnerId || !context.userOwnerId)) {
    throw new Error("Visibility context requires scopeOwnerId and userOwnerId.");
  }

  const ownedPayload = {
    ...source
  };

  if (context.scopeOwnerId) {
    ownedPayload.workspace_owner_id = context.scopeOwnerId;
  }
  if (context.userOwnerId) {
    ownedPayload.user_owner_id = context.userOwnerId;
  }

  return ownedPayload;
}

export { DEFAULT_VISIBILITY_COLUMNS, applyVisibility, applyVisibilityOwners };
