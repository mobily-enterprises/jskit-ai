function createController({ projectsService }) {
  if (!projectsService) {
    throw new Error("projectsService is required.");
  }

  async function list(request, reply) {
    const query = request.query || {};
    const response = await projectsService.list(request.workspace, {
      page: Number(query.page || 1),
      pageSize: Number(query.pageSize || 10)
    });
    reply.code(200).send(response);
  }

  async function get(request, reply) {
    const response = await projectsService.get(request.workspace, request.params?.projectId);
    reply.code(200).send(response);
  }

  async function create(request, reply) {
    const response = await projectsService.create(request.workspace, request.body || {});
    reply.code(200).send(response);
  }

  async function update(request, reply) {
    const response = await projectsService.update(
      request.workspace,
      request.params?.projectId,
      request.body || {}
    );
    reply.code(200).send(response);
  }

  async function replace(request, reply) {
    const response = await projectsService.replace(
      request.workspace,
      request.params?.projectId,
      request.body || {}
    );
    reply.code(200).send(response);
  }

  return {
    list,
    get,
    create,
    update,
    replace
  };
}

export { createController };
