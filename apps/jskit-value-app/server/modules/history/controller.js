const HISTORY_ACTION_IDS = Object.freeze({
  LIST: "history.list"
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
      actionId: HISTORY_ACTION_IDS.LIST,
      request,
      input: request.query || {}
    });
    reply.code(200).send(response);
  }

  return {
    list
  };
}

export { createController };
