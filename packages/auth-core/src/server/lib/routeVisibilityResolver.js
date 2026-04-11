import { normalizeOpaqueId } from "@jskit-ai/kernel/shared/support/normalize";

function createAuthRouteVisibilityResolver() {
  return Object.freeze({
    resolverId: "auth.policy.visibility",
    resolve({ visibility, context, request } = {}) {
      if (visibility !== "user") {
        return {};
      }

      const actor = context?.actor || request?.user || null;
      const userId = normalizeOpaqueId(actor?.id);
      if (userId == null) {
        return {};
      }

      return {
        userId,
        requiresActorScope: true
      };
    }
  });
}

export { createAuthRouteVisibilityResolver };
