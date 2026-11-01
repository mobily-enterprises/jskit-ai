import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";

function createAuthRouteVisibilityResolver() {
  function resolve({ visibility, context, request } = {}) {
    if (visibility !== "user") {
      return {};
    }

    const userId = resolveActorId(context, request);
    if (userId == null) {
      return {};
    }

    return {
      userId,
      requiresActorScope: true
    };
  }

  return Object.freeze({ resolverId: "auth.policy.visibility", resolve });
}

export { createAuthRouteVisibilityResolver };
