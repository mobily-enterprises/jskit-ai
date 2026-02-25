const DEG2RAD_ACTION_IDS = Object.freeze({
  CALCULATE: "deg2rad.calculate"
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

  async function calculate(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: DEG2RAD_ACTION_IDS.CALCULATE,
      request,
      input: request.body || {}
    });

    reply.code(200).send(result);
  }

  return {
    calculate
  };
}

export { createController };
