function createWorkspaceController({ authService, workspaceService, workspaceAdminService }) {
  if (!authService || !workspaceService || !workspaceAdminService) {
    throw new Error("authService, workspaceService, and workspaceAdminService are required.");
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

  async function getWorkspaceSettings(request, reply) {
    const response = await workspaceAdminService.getWorkspaceSettings(request.workspace);
    reply.code(200).send(response);
  }

  async function updateWorkspaceSettings(request, reply) {
    const response = await workspaceAdminService.updateWorkspaceSettings(request.workspace, request.body || {});
    reply.code(200).send(response);
  }

  async function listWorkspaceRoles(_request, reply) {
    const roleCatalog = workspaceAdminService.getRoleCatalog();
    reply.code(200).send({
      roleCatalog
    });
  }

  async function listWorkspaceMembers(request, reply) {
    const response = await workspaceAdminService.listMembers(request.workspace);
    reply.code(200).send(response);
  }

  async function updateWorkspaceMemberRole(request, reply) {
    const response = await workspaceAdminService.updateMemberRole(request.workspace, {
      memberUserId: request.params?.memberUserId,
      roleId: request.body?.roleId
    });
    reply.code(200).send(response);
  }

  async function listWorkspaceInvites(request, reply) {
    const response = await workspaceAdminService.listInvites(request.workspace);
    reply.code(200).send(response);
  }

  async function createWorkspaceInvite(request, reply) {
    const response = await workspaceAdminService.createInvite(request.workspace, request.user, request.body || {});
    reply.code(200).send(response);
  }

  async function revokeWorkspaceInvite(request, reply) {
    const response = await workspaceAdminService.revokeInvite(request.workspace, request.params?.inviteId);
    reply.code(200).send(response);
  }

  async function listPendingInvites(request, reply) {
    const pendingInvites = await workspaceService.listPendingInvitesForUser(request.user);
    reply.code(200).send({
      pendingInvites
    });
  }

  async function respondToPendingInvite(request, reply) {
    const payload = request.body || {};
    const response = await workspaceAdminService.respondToPendingInvite({
      user: request.user,
      inviteId: request.params?.inviteId,
      decision: payload.decision
    });
    reply.code(200).send(response);
  }

  return {
    bootstrap,
    listWorkspaces,
    selectWorkspace,
    getWorkspaceSettings,
    updateWorkspaceSettings,
    listWorkspaceRoles,
    listWorkspaceMembers,
    updateWorkspaceMemberRole,
    listWorkspaceInvites,
    createWorkspaceInvite,
    revokeWorkspaceInvite,
    listPendingInvites,
    respondToPendingInvite
  };
}

export { createWorkspaceController };
