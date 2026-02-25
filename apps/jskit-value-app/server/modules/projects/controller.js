const PROJECT_ACTION_IDS = Object.freeze({
  LIST: "projects.list",
  GET: "projects.get",
  CREATE: "projects.create",
  UPDATE: "projects.update"
});

async function executeAction(actionExecutor, { actionId, request, input = {} }) {
  return actionExecutor.execute({
    actionId,
    input,
    context: {
      request,
      channel: "api"
    }
  });
}

function createController({ actionExecutor }) {
  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required.");
  }

  async function list(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: PROJECT_ACTION_IDS.LIST,
      request,
      input: request.query || {}
    });
    reply.code(200).send(response);
  }

  async function get(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: PROJECT_ACTION_IDS.GET,
      request,
      input: {
        projectId: request.params?.projectId
      }
    });
    reply.code(200).send(response);
  }

  async function create(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: PROJECT_ACTION_IDS.CREATE,
      request,
      input: request.body || {}
    });
    reply.code(200).send(response);
  }

  async function update(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: PROJECT_ACTION_IDS.UPDATE,
      request,
      input: {
        ...(request.body || {}),
        projectId: request.params?.projectId
      }
    });

    reply.code(200).send(response);
  }

  async function replace(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: PROJECT_ACTION_IDS.UPDATE,
      request,
      input: {
        ...(request.body || {}),
        projectId: request.params?.projectId,
        mode: "replace"
      }
    });

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
