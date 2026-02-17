function createWorkspaceController({ authService, workspaceService }) {
  if (!authService || !workspaceService) {
    throw new Error("authService and workspaceService are required.");
  }

  async function bootstrap(request, reply) {
    const authResult = await authService.authenticateRequest(request);
    if (authResult.clearSession) {
      authService.clearSessionCookies(reply);
    }
    if (authResult.session) {
      authService.writeSessionCookies(reply, authResult.session);
    }

    if (authResult.transientFailure) {
      reply.code(503).send({
        error: "Authentication service temporarily unavailable. Please retry."
      });
      return;
    }

    const payload = await workspaceService.buildBootstrapPayload({
      request,
      user: authResult.authenticated ? authResult.profile : null
    });

    reply.code(200).send(payload);
  }

  async function listWorkspaces(request, reply) {
    const workspaces = await workspaceService.listWorkspacesForUser(request.user);
    reply.code(200).send({
      workspaces
    });
  }

  async function selectWorkspace(request, reply) {
    const payload = request.body || {};
    const workspaceSlug = payload.workspaceSlug || payload.slug || payload.workspaceId;
    const context = await workspaceService.selectWorkspaceForUser(request.user, workspaceSlug);
    reply.code(200).send({
      ok: true,
      ...context
    });
  }

  return {
    bootstrap,
    listWorkspaces,
    selectWorkspace
  };
}

export { createWorkspaceController };
