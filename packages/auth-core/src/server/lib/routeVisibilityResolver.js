function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function createAuthRouteVisibilityResolver() {
  return Object.freeze({
    resolverId: "auth.policy.visibility",
    resolve({ visibility, context, request } = {}) {
      if (visibility !== "user" && visibility !== "workspace_user") {
        return {};
      }

      const actor = context?.actor || request?.user || null;
      const userOwnerId = toPositiveInteger(actor?.id);
      if (!userOwnerId) {
        return {};
      }

      return {
        userOwnerId
      };
    }
  });
}

export { createAuthRouteVisibilityResolver };
