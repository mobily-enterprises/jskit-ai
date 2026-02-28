import { createService as createProjectsModuleService, schema as projectsSchema } from "../../../modules/projects/index.js";
import {
  publishProjectEventSafely,
  resolvePublishProjectEvent
} from "../../../realtime/publishers/projectPublisher.js";
import { normalizeHeaderValue, resolveCommandId, resolveSourceClientId } from "@jskit-ai/action-runtime-core";
import { resolveWorkspace } from "@jskit-ai/action-runtime-core/actionContributorHelpers";

const PROJECTS_CREATE_CAPABILITY = "projects.create";
const PROJECTS_UNARCHIVE_CAPABILITY = "projects.unarchive";
const PROJECTS_CAPACITY_LIMITATION_CODE = "projects.max";

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeProjectStatus(value, fallback = "draft") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "active" || normalized === "archived" || normalized === "draft") {
    return normalized;
  }
  return fallback;
}

function requireServiceMethod(service, methodName, contributorId) {
  if (!service || typeof service[methodName] !== "function") {
    throw new Error(`${contributorId} requires ${methodName}().`);
  }
}

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

function resolveUser(context, input) {
  const payload = normalizeObject(input);
  return payload.user || resolveRequest(context)?.user || context?.actor || null;
}

function resolveProjectId(input) {
  const payload = normalizeObject(input);
  return payload.projectId || payload.params?.projectId || null;
}

function resolveUsageEventKey(context, input) {
  const payload = normalizeObject(input);
  const payloadRequestMeta = normalizeObject(payload.requestMeta);
  return (
    normalizeHeaderValue(payloadRequestMeta.commandId) ||
    normalizeHeaderValue(payloadRequestMeta.idempotencyKey) ||
    normalizeHeaderValue(payload.idempotencyKey) ||
    normalizeHeaderValue(payload.commandId) ||
    normalizeHeaderValue(context?.requestMeta?.idempotencyKey) ||
    normalizeHeaderValue(context?.requestMeta?.commandId) ||
    null
  );
}

function buildRealtimePublishRequest(context, input, workspace, user) {
  const request = resolveRequest(context);
  const commandId = resolveCommandId(context, input);
  const sourceClientId = resolveSourceClientId(context, input);
  const headers = {
    ...(request?.headers || {})
  };
  if (commandId) {
    headers["x-command-id"] = commandId;
  }
  if (sourceClientId) {
    headers["x-client-id"] = sourceClientId;
  }

  return {
    ...(request && typeof request === "object" ? request : {}),
    headers,
    user: user || request?.user || context?.actor || null,
    workspace: workspace || request?.workspace || context?.workspace || null
  };
}

function resolvePatchPayload(input) {
  const payload = normalizeObject(input);
  if (payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)) {
    return payload.payload;
  }

  return payload;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

const PROJECTS_MAX_PAGE_SIZE =
  Number(projectsSchema?.query?.properties?.pageSize?.maximum) || 100;

const PROJECTS_LIST_TOOL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
  properties: {
    page: {
      type: "integer",
      minimum: 1
    },
    pageSize: {
      type: "integer",
      minimum: 1,
      maximum: PROJECTS_MAX_PAGE_SIZE
    }
  }
});

const PROJECTS_GET_TOOL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
  required: ["projectId"],
  properties: {
    projectId: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "integer", minimum: 1 }
      ]
    }
  }
});

const PROJECTS_CREATE_TOOL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
  required: ["name"],
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 160
    },
    description: {
      type: "string",
      maxLength: 1000
    },
    status: {
      type: "string",
      enum: ["draft", "active", "archived"]
    }
  }
});

const PROJECTS_UPDATE_TOOL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
  required: ["projectId"],
  properties: {
    projectId: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "integer", minimum: 1 }
      ]
    },
    mode: {
      type: "string",
      enum: ["update", "replace"]
    },
    name: {
      type: "string",
      minLength: 1,
      maxLength: 160
    },
    description: {
      type: "string",
      maxLength: 1000
    },
    status: {
      type: "string",
      enum: ["draft", "active", "archived"]
    }
  }
});

function createProjectsActionContributor({
  projectsService = null,
  projectsRepository = null,
  billingService = null,
  realtimeEventsService = null
} = {}) {
  const contributorId = "app.projects";
  const resolvedProjectsService =
    projectsService && typeof projectsService === "object"
      ? projectsService
      : projectsRepository
        ? createProjectsModuleService({
            projectsRepository
          }).service
        : null;

  requireServiceMethod(resolvedProjectsService, "list", contributorId);
  requireServiceMethod(resolvedProjectsService, "get", contributorId);
  requireServiceMethod(resolvedProjectsService, "create", contributorId);
  requireServiceMethod(resolvedProjectsService, "update", contributorId);
  requireServiceMethod(resolvedProjectsService, "replace", contributorId);
  requireServiceMethod(resolvedProjectsService, "countActiveForWorkspace", contributorId);

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
  const publishProjectEvent = resolvePublishProjectEvent(realtimeEventsService);

  function buildCapacityResolvers(workspace) {
    return {
      [PROJECTS_CAPACITY_LIMITATION_CODE]: async ({ trx = null } = {}) =>
        resolvedProjectsService.countActiveForWorkspace(workspace, trx ? { trx } : {})
    };
  }

  function publishProjectRealtimeEvent({ context, input, workspace, user, project, operation }) {
    return publishProjectEventSafely({
      publishProjectEvent,
      request: buildRealtimePublishRequest(context, input, workspace, user),
      workspace,
      project,
      operation
    });
  }

  async function refreshProjectCapacityLimit({ request, user, workspace }) {
    if (!ensureBillableEntity || !refreshDueLimitationsForSubject) {
      return;
    }

    const workspaceId = toPositiveInteger(workspace?.id);
    if (!workspaceId) {
      return;
    }

    const billableEntity = await ensureBillableEntity({
      workspaceId,
      ownerUserId: toPositiveInteger(workspace?.ownerUserId) || toPositiveInteger(user?.id) || null
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
      user
    });
  }

  return {
    contributorId,
    domain: "projects",
    actions: Object.freeze([
      {
        id: "projects.list",
        version: 1,
        kind: "query",
        channels: ["api", "assistant_tool", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["projects.read"],
        idempotency: "none",
        audit: {
          actionName: "projects.list"
        },
        observability: {},
        assistantTool: {
          description: "List projects in the active workspace.",
          inputJsonSchema: PROJECTS_LIST_TOOL_SCHEMA
        },
        async execute(input, context) {
          const payload = normalizeObject(input);
          return resolvedProjectsService.list(resolveWorkspace(context, payload), {
            page: payload.page,
            pageSize: payload.pageSize
          });
        }
      },
      {
        id: "projects.get",
        version: 1,
        kind: "query",
        channels: ["api", "assistant_tool", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["projects.read"],
        idempotency: "none",
        audit: {
          actionName: "projects.get"
        },
        observability: {},
        assistantTool: {
          description: "Get one project by id.",
          inputJsonSchema: PROJECTS_GET_TOOL_SCHEMA
        },
        async execute(input, context) {
          return resolvedProjectsService.get(resolveWorkspace(context, input), resolveProjectId(input));
        }
      },
      {
        id: "projects.create",
        version: 1,
        kind: "command",
        channels: ["api", "assistant_tool", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["projects.write"],
        idempotency: "none",
        audit: {
          actionName: "projects.create"
        },
        observability: {},
        assistantTool: {
          description: "Create a new project.",
          inputJsonSchema: PROJECTS_CREATE_TOOL_SCHEMA
        },
        async execute(input, context) {
          const payload = normalizeObject(input);
          const workspace = resolveWorkspace(context, payload);
          const request = resolveRequest(context);
          const user = resolveUser(context, payload);
          const runCreate = ({ trx = null } = {}) =>
            resolvedProjectsService.create(workspace, payload, trx ? { trx } : {});

          if (!executeWithEntitlementConsumption) {
            const response = await runCreate();
            publishProjectRealtimeEvent({
              context,
              input: payload,
              workspace,
              user,
              project: response?.project,
              operation: "created"
            });
            return response;
          }

          const response = await executeWithEntitlementConsumption({
            request,
            user,
            capability: PROJECTS_CREATE_CAPABILITY,
            usageEventKey: resolveUsageEventKey(context, payload),
            requestId: resolveRequestCommandId(context, payload),
            metadataJson: {
              capability: PROJECTS_CREATE_CAPABILITY,
              workspaceId: workspace?.id ? Number(workspace.id) : null
            },
            capacityResolvers: buildCapacityResolvers(workspace),
            action: ({ trx }) => runCreate({ trx })
          });
          publishProjectRealtimeEvent({
            context,
            input: payload,
            workspace,
            user,
            project: response?.project,
            operation: "created"
          });
          return response;
        }
      },
      {
        id: "projects.update",
        version: 1,
        kind: "command",
        channels: ["api", "assistant_tool", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["projects.write"],
        idempotency: "none",
        audit: {
          actionName: "projects.update"
        },
        observability: {},
        assistantTool: {
          description: "Update or replace a project.",
          inputJsonSchema: PROJECTS_UPDATE_TOOL_SCHEMA
        },
        async execute(input, context) {
          const payload = normalizeObject(input);
          const workspace = resolveWorkspace(context, payload);
          const user = resolveUser(context, payload);
          const request = resolveRequest(context);
          const projectId = resolveProjectId(payload);
          const patch = resolvePatchPayload(payload);
          const mode = String(payload.mode || "")
            .trim()
            .toLowerCase();

          const existing = await resolvedProjectsService.get(workspace, projectId);
          const previousStatus = normalizeProjectStatus(existing?.project?.status, "draft");
          const requestedStatus =
            mode === "replace"
              ? normalizeProjectStatus(patch.status || "draft", "draft")
              : Object.hasOwn(patch, "status")
                ? normalizeProjectStatus(patch.status, previousStatus)
                : previousStatus;
          const isUnarchiveTransition = previousStatus === "archived" && requestedStatus !== "archived";

          const runMutation = ({ trx = null } = {}) => {
            if (mode === "replace") {
              return resolvedProjectsService.replace(workspace, projectId, patch, trx ? { trx } : {});
            }
            return resolvedProjectsService.update(workspace, projectId, patch, trx ? { trx } : {});
          };

          const response =
            isUnarchiveTransition && executeWithEntitlementConsumption
              ? await executeWithEntitlementConsumption({
                  request,
                  user,
                  capability: PROJECTS_UNARCHIVE_CAPABILITY,
                  usageEventKey: resolveUsageEventKey(context, payload),
                  requestId: resolveRequestCommandId(context, payload),
                  metadataJson: {
                    capability: PROJECTS_UNARCHIVE_CAPABILITY,
                    projectId: Number(existing?.project?.id || 0) || null,
                    workspaceId: workspace?.id ? Number(workspace.id) : null
                  },
                  capacityResolvers: buildCapacityResolvers(workspace),
                  action: ({ trx }) => runMutation({ trx })
                })
              : await runMutation();

          const nextStatus = normalizeProjectStatus(response?.project?.status, previousStatus);
          const changedArchiveState = (previousStatus === "archived") !== (nextStatus === "archived");
          if (changedArchiveState && !isUnarchiveTransition) {
            await refreshProjectCapacityLimit({
              request,
              user,
              workspace
            });
          }

          publishProjectRealtimeEvent({
            context,
            input: payload,
            workspace,
            user,
            project: response?.project,
            operation: "updated"
          });

          return response;
        }
      }
    ])
  };
}

export { createProjectsActionContributor };
