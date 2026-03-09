import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { normalizeSurfaceId, normalizeSurfacePrefix } from "@jskit-ai/kernel/shared/surface";
import { schema } from "../../shared/schema/workspaceSchema.js";

const WORKSPACE_ROUTE_TAGS = Object.freeze(["workspace"]);
const AUTH_REQUIRED = "required";
const AUTH_PUBLIC = "public";
const WORKSPACE_POLICY_REQUIRED = "required";

function normalizeObjectInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return {
    ...value
  };
}

function normalizeMemberParams(params) {
  const source = normalizeObjectInput(params);
  return {
    workspaceSlug: source.workspaceSlug,
    memberUserId: source.memberUserId
  };
}

function normalizeInviteParams(params) {
  const source = normalizeObjectInput(params);
  return {
    workspaceSlug: source.workspaceSlug,
    inviteId: source.inviteId
  };
}

function normalizeWorkspaceParams(params) {
  const source = normalizeObjectInput(params);
  return {
    workspaceSlug: source.workspaceSlug
  };
}

function normalizeMemberRoleBody(body) {
  const source = normalizeObjectInput(body);
  return {
    roleId: source.roleId
  };
}

function normalizeWorkspaceSurfaceDefinitions(value) {
  const source = Array.isArray(value) ? value : [];
  const seenSurfaceIds = new Set();
  const normalizedSurfaces = [];

  for (const entry of source) {
    const record = entry && typeof entry === "object" ? entry : {};
    const surfaceId = normalizeSurfaceId(record.id);
    const surfacePrefix = normalizeSurfacePrefix(record.prefix);

    if (!surfaceId || seenSurfaceIds.has(surfaceId)) {
      continue;
    }

    seenSurfaceIds.add(surfaceId);
    normalizedSurfaces.push(
      Object.freeze({
        id: surfaceId,
        prefix: surfacePrefix
      })
    );
  }

  return normalizedSurfaces;
}

function resolveWorkspaceApiBasePath(surfacePrefix = "") {
  const normalizedPrefix = normalizeSurfacePrefix(surfacePrefix);
  if (normalizedPrefix) {
    return `/api${normalizedPrefix}`;
  }
  return "/api";
}

function buildWorkspaceResponse(payloadSchema, includeValidation400 = false) {
  const responseMap = {
    200: payloadSchema
  };

  if (includeValidation400) {
    return withStandardErrorResponses(responseMap, {
      includeValidation400: true
    });
  }

  return withStandardErrorResponses(responseMap);
}

function createWorkspaceRoute(options = {}) {
  const resolveHandler = options.resolveHandler;
  if (typeof resolveHandler !== "function") {
    throw new TypeError("createWorkspaceRoute requires resolveHandler().");
  }

  const route = {
    path: options.path,
    method: options.method,
    auth: options.auth || AUTH_REQUIRED,
    meta: {
      tags: WORKSPACE_ROUTE_TAGS,
      summary: options.summary
    },
    response: options.response,
    handler: resolveHandler(options.handlerName)
  };

  if (options.workspacePolicy) {
    route.workspacePolicy = options.workspacePolicy;
  }
  if (options.workspaceSurface) {
    route.workspaceSurface = options.workspaceSurface;
  }
  if (options.params) {
    route.params = options.params;
  }
  if (options.query) {
    route.query = options.query;
  }
  if (options.body) {
    route.body = options.body;
  }

  return route;
}

function createWorkspaceAdminRoutes({ resolveHandler, surfaceId, surfacePrefix }) {
  const workspaceApiBasePath = resolveWorkspaceApiBasePath(surfacePrefix);
  const workspaceScopedApiBasePath = `${workspaceApiBasePath}/w/:workspaceSlug`;
  const routes = [];

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: `${workspaceScopedApiBasePath}/workspace/settings`,
      method: "GET",
      auth: AUTH_REQUIRED,
      workspacePolicy: WORKSPACE_POLICY_REQUIRED,
      workspaceSurface: surfaceId,
      summary: "Get workspace settings and role catalog by workspace slug",
      params: {
        schema: schema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: buildWorkspaceResponse(schema.response.settings),
      handlerName: "getWorkspaceSettings"
    })
  );

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: `${workspaceScopedApiBasePath}/workspace/settings`,
      method: "PATCH",
      auth: AUTH_REQUIRED,
      workspacePolicy: WORKSPACE_POLICY_REQUIRED,
      workspaceSurface: surfaceId,
      summary: "Update workspace settings by workspace slug",
      params: {
        schema: schema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      body: {
        schema: schema.body.settingsUpdate,
        normalize: normalizeObjectInput
      },
      response: buildWorkspaceResponse(schema.response.settings, true),
      handlerName: "updateWorkspaceSettings"
    })
  );

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: `${workspaceScopedApiBasePath}/workspace/roles`,
      method: "GET",
      auth: AUTH_REQUIRED,
      workspacePolicy: WORKSPACE_POLICY_REQUIRED,
      workspaceSurface: surfaceId,
      summary: "Get workspace role catalog by workspace slug",
      params: {
        schema: schema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: buildWorkspaceResponse(schema.response.roles),
      handlerName: "listWorkspaceRoles"
    })
  );

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: `${workspaceScopedApiBasePath}/workspace/members`,
      method: "GET",
      auth: AUTH_REQUIRED,
      workspacePolicy: WORKSPACE_POLICY_REQUIRED,
      workspaceSurface: surfaceId,
      summary: "List members by workspace slug",
      params: {
        schema: schema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: buildWorkspaceResponse(schema.response.members),
      handlerName: "listWorkspaceMembers"
    })
  );

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: `${workspaceScopedApiBasePath}/workspace/members/:memberUserId/role`,
      method: "PATCH",
      auth: AUTH_REQUIRED,
      workspacePolicy: WORKSPACE_POLICY_REQUIRED,
      workspaceSurface: surfaceId,
      summary: "Update workspace member role by workspace slug",
      params: {
        schema: schema.params.member,
        normalize: normalizeMemberParams
      },
      body: {
        schema: schema.body.memberRoleUpdate,
        normalize: normalizeMemberRoleBody
      },
      response: buildWorkspaceResponse(schema.response.members, true),
      handlerName: "updateWorkspaceMemberRole"
    })
  );

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: `${workspaceScopedApiBasePath}/workspace/invites`,
      method: "GET",
      auth: AUTH_REQUIRED,
      workspacePolicy: WORKSPACE_POLICY_REQUIRED,
      workspaceSurface: surfaceId,
      summary: "List workspace invites by workspace slug",
      params: {
        schema: schema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: buildWorkspaceResponse(schema.response.invites),
      handlerName: "listWorkspaceInvites"
    })
  );

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: `${workspaceScopedApiBasePath}/workspace/invites`,
      method: "POST",
      auth: AUTH_REQUIRED,
      workspacePolicy: WORKSPACE_POLICY_REQUIRED,
      workspaceSurface: surfaceId,
      summary: "Create workspace invite by workspace slug",
      params: {
        schema: schema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      body: {
        schema: schema.body.createInvite,
        normalize: normalizeObjectInput
      },
      response: buildWorkspaceResponse(schema.response.invites, true),
      handlerName: "createWorkspaceInvite"
    })
  );

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: `${workspaceScopedApiBasePath}/workspace/invites/:inviteId`,
      method: "DELETE",
      auth: AUTH_REQUIRED,
      workspacePolicy: WORKSPACE_POLICY_REQUIRED,
      workspaceSurface: surfaceId,
      summary: "Revoke workspace invite by workspace slug",
      params: {
        schema: schema.params.invite,
        normalize: normalizeInviteParams
      },
      response: buildWorkspaceResponse(schema.response.invites),
      handlerName: "revokeWorkspaceInvite"
    })
  );

  return routes;
}

function buildRoutes(controller, { workspaceSurfaceDefinitions = [] } = {}) {
  if (!controller) {
    throw new Error("Workspace routes require controller instance.");
  }

  const resolveHandler = (name) => controller[name].bind(controller);
  const workspaceSurfaces = normalizeWorkspaceSurfaceDefinitions(workspaceSurfaceDefinitions);
  const routes = [];

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: "/api/bootstrap",
      method: "GET",
      auth: AUTH_PUBLIC,
      summary: "Get startup bootstrap payload with session, app, workspace, and settings context",
      query: {
        schema: schema.query.bootstrap,
        normalize: normalizeObjectInput
      },
      response: buildWorkspaceResponse(schema.response.bootstrap),
      handlerName: "bootstrap"
    })
  );

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: "/api/workspaces",
      method: "GET",
      auth: AUTH_REQUIRED,
      summary: "List workspaces visible to authenticated user",
      response: buildWorkspaceResponse(schema.response.workspacesList),
      handlerName: "listWorkspaces"
    })
  );

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: "/api/workspace/invitations/pending",
      method: "GET",
      auth: AUTH_REQUIRED,
      summary: "List pending workspace invitations for authenticated user",
      response: buildWorkspaceResponse(schema.response.pendingInvites),
      handlerName: "listPendingInvites"
    })
  );

  routes.push(
    createWorkspaceRoute({
      resolveHandler,
      path: "/api/workspace/invitations/redeem",
      method: "POST",
      auth: AUTH_REQUIRED,
      summary: "Accept or refuse a workspace invitation using an invite token",
      body: {
        schema: schema.body.redeemInvite,
        normalize: normalizeObjectInput
      },
      response: buildWorkspaceResponse(schema.response.respondToInvite, true),
      handlerName: "respondToPendingInviteByToken"
    })
  );

  for (const workspaceSurface of workspaceSurfaces) {
    const adminRoutes = createWorkspaceAdminRoutes({
      resolveHandler,
      surfaceId: workspaceSurface.id,
      surfacePrefix: workspaceSurface.prefix
    });

    for (const route of adminRoutes) {
      routes.push(route);
    }
  }

  return routes;
}

export { buildRoutes };
