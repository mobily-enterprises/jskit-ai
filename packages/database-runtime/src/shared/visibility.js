import { normalizeVisibilityContext } from "@jskit-ai/kernel/shared/support/visibility";

const ALWAYS_FALSE_SQL = "1 = 0";
const DEFAULT_VISIBILITY_COLUMNS = Object.freeze({
  workspaceOwnerId: "workspace_owner_id",
  userOwnerId: "user_owner_id"
});

function applyVisibility(queryBuilder, visibilityContext = {}) {
  const context = normalizeVisibilityContext(visibilityContext);
  const workspaceColumn = DEFAULT_VISIBILITY_COLUMNS.workspaceOwnerId;
  const userColumn = DEFAULT_VISIBILITY_COLUMNS.userOwnerId;

  if (context.visibility === "public") {
    return queryBuilder;
  }

  if (context.visibility === "workspace") {
    if (!context.workspaceOwnerId) {
      return queryBuilder.whereRaw(ALWAYS_FALSE_SQL);
    }
    return queryBuilder.where(workspaceColumn, context.workspaceOwnerId);
  }

  if (context.visibility === "user") {
    if (!context.userOwnerId) {
      return queryBuilder.whereRaw(ALWAYS_FALSE_SQL);
    }
    return queryBuilder.where(userColumn, context.userOwnerId);
  }

  if (!context.workspaceOwnerId || !context.userOwnerId) {
    return queryBuilder.whereRaw(ALWAYS_FALSE_SQL);
  }

  return queryBuilder.where(workspaceColumn, context.workspaceOwnerId).where(userColumn, context.userOwnerId);
}

function applyVisibilityOwners(payload = {}, visibilityContext = {}) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const context = normalizeVisibilityContext(visibilityContext);

  if (context.visibility === "public") {
    return {
      ...source
    };
  }

  if (context.visibility === "workspace" && !context.workspaceOwnerId) {
    throw new Error("Visibility context requires workspaceOwnerId.");
  }
  if (context.visibility === "user" && !context.userOwnerId) {
    throw new Error("Visibility context requires userOwnerId.");
  }
  if (context.visibility === "workspace_user" && (!context.workspaceOwnerId || !context.userOwnerId)) {
    throw new Error("Visibility context requires workspaceOwnerId and userOwnerId.");
  }

  const ownedPayload = {
    ...source
  };

  if (context.workspaceOwnerId) {
    ownedPayload.workspace_owner_id = context.workspaceOwnerId;
  }
  if (context.userOwnerId) {
    ownedPayload.user_owner_id = context.userOwnerId;
  }

  return ownedPayload;
}

export { DEFAULT_VISIBILITY_COLUMNS, applyVisibility, applyVisibilityOwners };
