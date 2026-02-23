function createController({ deg2radHistoryService }) {
  async function list(request, reply) {
    const user = request.user;
    const workspaceId = request.workspace?.id;
    const query = request.query || {};
    const pagination = {
      page: Number(query.page || 1),
      pageSize: Number(query.pageSize || 10)
    };
    const response = await deg2radHistoryService.listForUser(workspaceId, user, pagination);
    reply.code(200).send(response);
  }

  return {
    list
  };
}

export { createController };
