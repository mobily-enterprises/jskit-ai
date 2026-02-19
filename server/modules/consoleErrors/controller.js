function createController({ consoleErrorsService }) {
  if (!consoleErrorsService) {
    throw new Error("consoleErrorsService is required.");
  }

  async function listBrowserErrors(request, reply) {
    const query = request.query || {};
    const response = await consoleErrorsService.listBrowserErrors(request.user, {
      page: Number(query.page || 1),
      pageSize: Number(query.pageSize || 20)
    });
    reply.code(200).send(response);
  }

  async function getBrowserError(request, reply) {
    const params = request.params || {};
    const response = await consoleErrorsService.getBrowserError(request.user, params.errorId);
    reply.code(200).send(response);
  }

  async function listServerErrors(request, reply) {
    const query = request.query || {};
    const response = await consoleErrorsService.listServerErrors(request.user, {
      page: Number(query.page || 1),
      pageSize: Number(query.pageSize || 20)
    });
    reply.code(200).send(response);
  }

  async function getServerError(request, reply) {
    const params = request.params || {};
    const response = await consoleErrorsService.getServerError(request.user, params.errorId);
    reply.code(200).send(response);
  }

  async function recordBrowserError(request, reply) {
    await consoleErrorsService.recordBrowserError({
      payload: request.body || {},
      user: request.user || null
    });

    reply.code(200).send({
      ok: true
    });
  }

  async function simulateServerError(request, reply) {
    const payload = request.body || {};
    const response = await consoleErrorsService.simulateServerError({
      user: request.user,
      payload
    });
    reply.code(200).send(response);
  }

  return {
    listBrowserErrors,
    getBrowserError,
    listServerErrors,
    getServerError,
    recordBrowserError,
    simulateServerError
  };
}

export { createController };
