import { ACTION_IDS } from "../../../shared/actionIds.js";

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
      actionId: ACTION_IDS.SETTINGS_ALERTS_LIST,
      request,
      input: request.query || {}
    });

    reply.code(200).send(response);
  }

  async function markAllRead(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: ACTION_IDS.SETTINGS_ALERTS_READ_ALL,
      request,
      input: {}
    });

    reply.code(200).send(response);
  }

  return {
    list,
    markAllRead
  };
}

export { createController };
