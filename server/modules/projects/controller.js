import { createProjectEventPublisher } from "../../realtime/publishers/projectPublisher.js";

function normalizeHeaderValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

const PROJECTS_CREATE_CAPABILITY = "projects.create";

function createController({ projectsService, realtimeEventsService = null, billingService = null }) {
  if (!projectsService) {
    throw new Error("projectsService is required.");
  }

  const publishProjectEventForRequest = createProjectEventPublisher({
    realtimeEventsService,
    logCode: "projects.realtime.publish_failed"
  });
  const enforceLimitAndRecordUsage =
    billingService && typeof billingService.enforceLimitAndRecordUsage === "function"
      ? billingService.enforceLimitAndRecordUsage.bind(billingService)
      : null;

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
    const runCreate = () => projectsService.create(request.workspace, request.body || {});
    const response = enforceLimitAndRecordUsage
      ? await enforceLimitAndRecordUsage({
          request,
          user: request?.user,
          capability: PROJECTS_CREATE_CAPABILITY,
          usageEventKey:
            normalizeHeaderValue(request?.headers?.["idempotency-key"]) ||
            normalizeHeaderValue(request?.headers?.["x-command-id"]) ||
            null,
          metadataJson: {
            capability: PROJECTS_CREATE_CAPABILITY,
            workspaceId: request?.workspace?.id ? Number(request.workspace.id) : null
          },
          action: runCreate
        })
      : await runCreate();
    publishProjectEventForRequest({
      request,
      workspace: request.workspace,
      project: response?.project,
      operation: "created"
    });
    reply.code(200).send(response);
  }

  async function update(request, reply) {
    const response = await projectsService.update(
      request.workspace,
      request.params?.projectId,
      request.body || {}
    );
    publishProjectEventForRequest({
      request,
      workspace: request.workspace,
      project: response?.project,
      operation: "updated"
    });
    reply.code(200).send(response);
  }

  async function replace(request, reply) {
    const response = await projectsService.replace(
      request.workspace,
      request.params?.projectId,
      request.body || {}
    );
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
