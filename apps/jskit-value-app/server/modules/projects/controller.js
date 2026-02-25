import { createProjectEventPublisher } from "../../realtime/publishers/projectPublisher.js";

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

function createController({ realtimeEventsService = null, actionExecutor }) {
  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required.");
  }

  const publishProjectEventForRequest = createProjectEventPublisher({
    realtimeEventsService,
    logCode: "projects.realtime.publish_failed"
  });

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
    publishProjectEventForRequest({
      request,
      workspace: request.workspace,
      project: response?.project,
      operation: "created"
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

    publishProjectEventForRequest({
      request,
      workspace: request.workspace,
      project: response?.project,
      operation: "updated"
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

    publishProjectEventForRequest({
      request,
      workspace: request.workspace,
      project: response?.project,
      operation: "updated"
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
