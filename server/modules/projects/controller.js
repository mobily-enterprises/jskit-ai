function normalizeHeaderValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function createController({ projectsService, realtimeEventsService = null }) {
  if (!projectsService) {
    throw new Error("projectsService is required.");
  }

  const publishProjectEvent =
    realtimeEventsService && typeof realtimeEventsService.publishProjectEvent === "function"
      ? realtimeEventsService.publishProjectEvent
      : null;

  function publishProjectEventSafely({ request, response, operation }) {
    if (!publishProjectEvent || !response?.project) {
      return;
    }

    try {
      publishProjectEvent({
        operation,
        workspace: request.workspace,
        project: response.project,
        commandId: normalizeHeaderValue(request?.headers?.["x-command-id"]),
        sourceClientId: normalizeHeaderValue(request?.headers?.["x-client-id"]),
        actorUserId: request?.user?.id
      });
    } catch (error) {
      const warnLogger = request?.log && typeof request.log.warn === "function" ? request.log.warn.bind(request.log) : null;
      if (warnLogger) {
        warnLogger({ err: error }, "projects.realtime.publish_failed");
      }
    }
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
    publishProjectEventSafely({ request, response, operation: "created" });
    reply.code(200).send(response);
  }

  async function update(request, reply) {
    const response = await projectsService.update(
      request.workspace,
      request.params?.projectId,
      request.body || {}
    );
    publishProjectEventSafely({ request, response, operation: "updated" });
    reply.code(200).send(response);
  }

  async function replace(request, reply) {
    const response = await projectsService.replace(
      request.workspace,
      request.params?.projectId,
      request.body || {}
    );
    publishProjectEventSafely({ request, response, operation: "updated" });
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
