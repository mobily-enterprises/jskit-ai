function createController({ godService }) {
  if (!godService) {
    throw new Error("godService is required.");
  }

  async function bootstrap(request, reply) {
    const payload = await godService.buildBootstrapPayload({
      user: request.user || null
    });
    reply.code(200).send(payload);
  }

  async function listRoles(request, reply) {
    const response = await godService.listRoles(request.user);
    reply.code(200).send(response);
  }

  async function listMembers(request, reply) {
    const response = await godService.listMembers(request.user);
    reply.code(200).send(response);
  }

  async function updateMemberRole(request, reply) {
    const response = await godService.updateMemberRole(request.user, {
      memberUserId: request.params?.memberUserId,
      roleId: request.body?.roleId
    });
    reply.code(200).send(response);
  }

  async function listInvites(request, reply) {
    const response = await godService.listInvites(request.user);
    reply.code(200).send(response);
  }

  async function createInvite(request, reply) {
    const response = await godService.createInvite(request.user, request.body || {});
    reply.code(200).send(response);
  }

  async function revokeInvite(request, reply) {
    const response = await godService.revokeInvite(request.user, request.params?.inviteId);
    reply.code(200).send(response);
  }

  async function listPendingInvites(request, reply) {
    const pendingInvites = await godService.listPendingInvitesForUser(request.user);
    reply.code(200).send({
      pendingInvites
    });
  }

  async function respondToPendingInviteByToken(request, reply) {
    const payload = request.body || {};
    const response = await godService.respondToPendingInviteByToken({
      user: request.user,
      inviteToken: payload.token,
      decision: payload.decision
    });
    reply.code(200).send(response);
  }

  return {
    bootstrap,
    listRoles,
    listMembers,
    updateMemberRole,
    listInvites,
    createInvite,
    revokeInvite,
    listPendingInvites,
    respondToPendingInviteByToken
  };
}

export { createController };
