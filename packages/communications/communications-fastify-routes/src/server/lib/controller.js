const COMMUNICATIONS_ACTION_IDS = Object.freeze({
  WORKSPACE_SMS_SEND: "workspace.sms.send"
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

function createController({ communicationsService, actionExecutor }) {
  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required.");
  }

  async function sendSms(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: COMMUNICATIONS_ACTION_IDS.WORKSPACE_SMS_SEND,
      request,
      input: request.body || {}
    });
    reply.code(200).send(response);
  }

  async function sendEmail(request, reply) {
    if (!communicationsService || typeof communicationsService.sendEmail !== "function") {
      throw new Error("communicationsService.sendEmail is required.");
    }

    const response = await communicationsService.sendEmail(request.body || {});
    reply.code(200).send(response);
  }

  return {
    sendSms,
    sendEmail
  };
}

export { createController };
