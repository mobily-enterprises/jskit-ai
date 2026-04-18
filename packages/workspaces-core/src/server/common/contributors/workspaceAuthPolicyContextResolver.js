import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function createWorkspaceAuthPolicyContextResolver({ workspaceService } = {}) {
  if (!workspaceService || typeof workspaceService.resolveWorkspaceContextForUserBySlug !== "function") {
    throw new Error(
      "workspace auth policy context resolver requires workspaceService.resolveWorkspaceContextForUserBySlug()."
    );
  }

  return async function resolveWorkspaceAuthPolicyContext({ request, actor, meta } = {}) {
    const contextPolicy = normalizeText(meta?.contextPolicy || "none").toLowerCase() || "none";
    const permission = normalizeText(meta?.permission);
    if (contextPolicy === "none" && !permission) {
      return {};
    }

    const workspaceSlug = normalizeText(request?.params?.workspaceSlug).toLowerCase();
    if (!workspaceSlug || !actor) {
      return {};
    }

    const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(actor, workspaceSlug, {
      request
    });

    return {
      workspace: resolvedWorkspaceContext?.workspace || null,
      membership: resolvedWorkspaceContext?.membership || null,
      permissions: Array.isArray(resolvedWorkspaceContext?.permissions) ? resolvedWorkspaceContext.permissions : []
    };
  };
}

export { createWorkspaceAuthPolicyContextResolver };
