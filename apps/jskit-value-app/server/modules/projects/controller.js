import { createProjectEventPublisher } from "../../realtime/publishers/projectPublisher.js";

function normalizeHeaderValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

const PROJECTS_CREATE_CAPABILITY = "projects.create";
const PROJECTS_UNARCHIVE_CAPABILITY = "projects.unarchive";
const PROJECTS_CAPACITY_LIMITATION_CODE = "projects.max";

function normalizeProjectStatus(value, fallback = "draft") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "active" || normalized === "archived" || normalized === "draft") {
    return normalized;
  }
  return fallback;
}

function resolveUsageEventKey(request) {
  return (
    normalizeHeaderValue(request?.headers?.["idempotency-key"]) ||
    normalizeHeaderValue(request?.headers?.["x-command-id"]) ||
    null
  );
}

function resolveRequestCommandId(request) {
  return (
    normalizeHeaderValue(request?.headers?.["x-command-id"]) ||
    normalizeHeaderValue(request?.headers?.["idempotency-key"]) ||
    null
  );
}

function createController({ projectsService, realtimeEventsService = null, billingService = null }) {
  if (!projectsService) {
    throw new Error("projectsService is required.");
  }

  const publishProjectEventForRequest = createProjectEventPublisher({
    realtimeEventsService,
    logCode: "projects.realtime.publish_failed"
  });
  const executeWithEntitlementConsumption =
    billingService && typeof billingService.executeWithEntitlementConsumption === "function"
      ? billingService.executeWithEntitlementConsumption.bind(billingService)
      : null;
  const ensureBillableEntity =
    billingService && typeof billingService.ensureBillableEntity === "function"
      ? billingService.ensureBillableEntity.bind(billingService)
      : null;
  const refreshDueLimitationsForSubject =
    billingService && typeof billingService.refreshDueLimitationsForSubject === "function"
      ? billingService.refreshDueLimitationsForSubject.bind(billingService)
      : null;

  function buildCapacityResolvers(request) {
    return {
      [PROJECTS_CAPACITY_LIMITATION_CODE]: async ({ trx = null } = {}) =>
        projectsService.countActiveForWorkspace(request.workspace, trx ? { trx } : {})
    };
  }

  async function refreshProjectCapacityLimit(request) {
    if (!ensureBillableEntity || !refreshDueLimitationsForSubject) {
      return;
    }

    const workspaceId = Number(request?.workspace?.id || 0);
    if (!Number.isInteger(workspaceId) || workspaceId < 1) {
      return;
    }

    const billableEntity = await ensureBillableEntity({
      workspaceId,
      ownerUserId: Number(request?.workspace?.ownerUserId || request?.user?.id || 0) || null
    });
    if (!billableEntity?.id) {
      return;
    }

    await refreshDueLimitationsForSubject({
      billableEntityId: Number(billableEntity.id),
      limitationCodes: [PROJECTS_CAPACITY_LIMITATION_CODE],
      changeSource: "manual_refresh",
      now: new Date(),
      request,
      user: request?.user
    });
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
    const runCreate = ({ trx = null } = {}) =>
      projectsService.create(request.workspace, request.body || {}, trx ? { trx } : {});
    const response = executeWithEntitlementConsumption
      ? await executeWithEntitlementConsumption({
          request,
          user: request?.user,
          capability: PROJECTS_CREATE_CAPABILITY,
          usageEventKey: resolveUsageEventKey(request),
          requestId: resolveRequestCommandId(request),
          metadataJson: {
            capability: PROJECTS_CREATE_CAPABILITY,
            workspaceId: request?.workspace?.id ? Number(request.workspace.id) : null
          },
          capacityResolvers: buildCapacityResolvers(request),
          action: ({ trx }) => runCreate({ trx })
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
    const existing = await projectsService.get(request.workspace, request.params?.projectId);
    const previousStatus = normalizeProjectStatus(existing?.project?.status, "draft");
    const body = request.body || {};
    const requestedStatus = Object.hasOwn(body, "status")
      ? normalizeProjectStatus(body.status, previousStatus)
      : previousStatus;
    const isUnarchiveTransition = previousStatus === "archived" && requestedStatus !== "archived";

    const runUpdate = ({ trx = null } = {}) =>
      projectsService.update(request.workspace, request.params?.projectId, body, trx ? { trx } : {});
    const response =
      isUnarchiveTransition && executeWithEntitlementConsumption
        ? await executeWithEntitlementConsumption({
            request,
            user: request?.user,
            capability: PROJECTS_UNARCHIVE_CAPABILITY,
            usageEventKey: resolveUsageEventKey(request),
            requestId: resolveRequestCommandId(request),
            metadataJson: {
              capability: PROJECTS_UNARCHIVE_CAPABILITY,
              projectId: Number(existing?.project?.id || 0) || null,
              workspaceId: request?.workspace?.id ? Number(request.workspace.id) : null
            },
            capacityResolvers: buildCapacityResolvers(request),
            action: ({ trx }) => runUpdate({ trx })
          })
        : await runUpdate();

    const nextStatus = normalizeProjectStatus(response?.project?.status, previousStatus);
    const changedArchiveState = (previousStatus === "archived") !== (nextStatus === "archived");
    if (changedArchiveState && !isUnarchiveTransition) {
      await refreshProjectCapacityLimit(request);
    }
    publishProjectEventForRequest({
      request,
      workspace: request.workspace,
      project: response?.project,
      operation: "updated"
    });
    reply.code(200).send(response);
  }

  async function replace(request, reply) {
    const existing = await projectsService.get(request.workspace, request.params?.projectId);
    const previousStatus = normalizeProjectStatus(existing?.project?.status, "draft");
    const body = request.body || {};
    const requestedStatus = normalizeProjectStatus(body.status || "draft", "draft");
    const isUnarchiveTransition = previousStatus === "archived" && requestedStatus !== "archived";

    const runReplace = ({ trx = null } = {}) =>
      projectsService.replace(request.workspace, request.params?.projectId, body, trx ? { trx } : {});
    const response =
      isUnarchiveTransition && executeWithEntitlementConsumption
        ? await executeWithEntitlementConsumption({
            request,
            user: request?.user,
            capability: PROJECTS_UNARCHIVE_CAPABILITY,
            usageEventKey: resolveUsageEventKey(request),
            requestId: resolveRequestCommandId(request),
            metadataJson: {
              capability: PROJECTS_UNARCHIVE_CAPABILITY,
              projectId: Number(existing?.project?.id || 0) || null,
              workspaceId: request?.workspace?.id ? Number(request.workspace.id) : null
            },
            capacityResolvers: buildCapacityResolvers(request),
            action: ({ trx }) => runReplace({ trx })
          })
        : await runReplace();

    const nextStatus = normalizeProjectStatus(response?.project?.status, previousStatus);
    const changedArchiveState = (previousStatus === "archived") !== (nextStatus === "archived");
    if (changedArchiveState && !isUnarchiveTransition) {
      await refreshProjectCapacityLimit(request);
    }
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
