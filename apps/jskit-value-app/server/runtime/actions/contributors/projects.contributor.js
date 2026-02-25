import { createService as createProjectsModuleService } from "../../../modules/projects/index.js";

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function requireServiceMethod(service, methodName, contributorId) {
  if (!service || typeof service[methodName] !== "function") {
    throw new Error(`${contributorId} requires ${methodName}().`);
  }
}

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

function resolveWorkspace(context, input) {
  const payload = normalizeObject(input);
  return payload.workspace || resolveRequest(context)?.workspace || context?.workspace || null;
}

function resolveProjectId(input) {
  const payload = normalizeObject(input);
  return payload.projectId || payload.params?.projectId || null;
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

function createProjectsActionContributor({ projectsService = null, projectsRepository = null } = {}) {
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

  return {
    contributorId,
    domain: "projects",
    actions: Object.freeze([
      {
        id: "projects.list",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["projects.read"],
        idempotency: "none",
        audit: {
          actionName: "projects.list"
        },
        observability: {},
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
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["projects.read"],
        idempotency: "none",
        audit: {
          actionName: "projects.get"
        },
        observability: {},
        async execute(input, context) {
          return resolvedProjectsService.get(resolveWorkspace(context, input), resolveProjectId(input));
        }
      },
      {
        id: "projects.create",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["projects.write"],
        idempotency: "optional",
        audit: {
          actionName: "projects.create"
        },
        observability: {},
        async execute(input, context) {
          return resolvedProjectsService.create(resolveWorkspace(context, input), normalizeObject(input));
        }
      },
      {
        id: "projects.update",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["projects.write"],
        idempotency: "optional",
        audit: {
          actionName: "projects.update"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          const patch =
            payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
              ? payload.payload
              : payload;
          const mode = String(payload.mode || "")
            .trim()
            .toLowerCase();

          if (mode === "replace") {
            return resolvedProjectsService.replace(resolveWorkspace(context, payload), resolveProjectId(payload), patch);
          }

          return resolvedProjectsService.update(resolveWorkspace(context, payload), resolveProjectId(payload), patch);
        }
      }
    ])
  };
}

export { createProjectsActionContributor };
