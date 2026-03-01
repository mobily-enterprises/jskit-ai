const CONSOLE_ERRORS_ACTION_IDS = Object.freeze({
  BROWSER_LIST: "console.errors.browser.list",
  BROWSER_GET: "console.errors.browser.get",
  BROWSER_RECORD: "console.errors.browser.record",
  SERVER_LIST: "console.errors.server.list",
  SERVER_GET: "console.errors.server.get",
  SERVER_SIMULATE: "console.errors.server.simulate"
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

  async function listBrowserErrors(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ERRORS_ACTION_IDS.BROWSER_LIST,
      request,
      input: request.query || {}
    });
    reply.code(200).send(response);
  }

  async function getBrowserError(request, reply) {
    const params = request.params || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ERRORS_ACTION_IDS.BROWSER_GET,
      request,
      input: {
        errorId: params.errorId
      }
    });
    reply.code(200).send(response);
  }

  async function listServerErrors(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ERRORS_ACTION_IDS.SERVER_LIST,
      request,
      input: request.query || {}
    });
    reply.code(200).send(response);
  }

  async function getServerError(request, reply) {
    const params = request.params || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ERRORS_ACTION_IDS.SERVER_GET,
      request,
      input: {
        errorId: params.errorId
      }
    });
    reply.code(200).send(response);
  }

  async function recordBrowserError(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ERRORS_ACTION_IDS.BROWSER_RECORD,
      request,
      input: request.body || {}
    });

    reply.code(200).send(response);
  }

  async function simulateServerError(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ERRORS_ACTION_IDS.SERVER_SIMULATE,
      request,
      input: payload
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
