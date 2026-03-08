import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { normalizeSurfaceId, normalizeSurfacePrefix } from "@jskit-ai/kernel/shared/surface";
import { schema } from "../schema/workspaceSchema.js";

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
    memberUserId: source.memberUserId
  };
}

function normalizeInviteParams(params) {
  const source = normalizeObjectInput(params);
  return {
    inviteId: source.inviteId
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
  const seen = new Set();
  const normalized = [];

  for (const entry of source) {
    const record = entry && typeof entry === "object" ? entry : {};
    const surfaceId = normalizeSurfaceId(record.id);
    const surfacePrefix = normalizeSurfacePrefix(record.prefix);
    if (!surfaceId || seen.has(surfaceId)) {
      continue;
    }

    seen.add(surfaceId);
    normalized.push(
      Object.freeze({
        id: surfaceId,
        prefix: surfacePrefix
      })
    );
  }

  return normalized;
}

function resolveWorkspaceApiBasePath(surfacePrefix = "") {
  const normalizedPrefix = normalizeSurfacePrefix(surfacePrefix);
  return normalizedPrefix ? `/api${normalizedPrefix}` : "/api";
}

function createWorkspaceAdminRoutes({ handler, surfaceId, surfacePrefix }) {
  const workspaceApiBasePath = resolveWorkspaceApiBasePath(surfacePrefix);

  return [
    {
      path: `${workspaceApiBasePath}/workspace/settings`,
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: surfaceId,
      permission: "workspace.settings.view",
      meta: {
        tags: ["workspace"],
        summary: "Get active workspace settings and role catalog"
      },
      response: withStandardErrorResponses({
        200: schema.response.settings
      }),
      handler: handler("getWorkspaceSettings")
    },
    {
      path: `${workspaceApiBasePath}/workspace/settings`,
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: surfaceId,
      permission: "workspace.settings.update",
      meta: {
        tags: ["workspace"],
        summary: "Update active workspace settings"
      },
      body: {
        schema: schema.body.settingsUpdate,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: schema.response.settings
        },
        { includeValidation400: true }
      ),
      handler: handler("updateWorkspaceSettings")
    },
    {
      path: `${workspaceApiBasePath}/workspace/roles`,
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: surfaceId,
      permission: "workspace.roles.view",
      meta: {
        tags: ["workspace"],
        summary: "Get workspace role catalog"
      },
      response: withStandardErrorResponses({
        200: schema.response.roles
      }),
      handler: handler("listWorkspaceRoles")
    },
    {
      path: `${workspaceApiBasePath}/workspace/members`,
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: surfaceId,
      permission: "workspace.members.view",
      meta: {
        tags: ["workspace"],
        summary: "List active members for active workspace"
      },
      response: withStandardErrorResponses({
        200: schema.response.members
      }),
      handler: handler("listWorkspaceMembers")
    },
    {
      path: `${workspaceApiBasePath}/workspace/members/:memberUserId/role`,
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: surfaceId,
      permission: "workspace.members.manage",
      meta: {
        tags: ["workspace"],
        summary: "Update member role in active workspace"
      },
      params: {
        schema: schema.params.member,
        normalize: normalizeMemberParams
      },
      body: {
        schema: schema.body.memberRoleUpdate,
        normalize: normalizeMemberRoleBody
      },
      response: withStandardErrorResponses(
        {
          200: schema.response.members
        },
        { includeValidation400: true }
      ),
      handler: handler("updateWorkspaceMemberRole")
    },
    {
      path: `${workspaceApiBasePath}/workspace/invites`,
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: surfaceId,
      permission: "workspace.members.view",
      meta: {
        tags: ["workspace"],
        summary: "List pending invites for active workspace"
      },
      response: withStandardErrorResponses({
        200: schema.response.invites
      }),
      handler: handler("listWorkspaceInvites")
    },
    {
      path: `${workspaceApiBasePath}/workspace/invites`,
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: surfaceId,
      permission: "workspace.members.invite",
      meta: {
        tags: ["workspace"],
        summary: "Create invite for active workspace"
      },
      body: {
        schema: schema.body.createInvite,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: schema.response.invites
        },
        { includeValidation400: true }
      ),
      handler: handler("createWorkspaceInvite")
    },
    {
      path: `${workspaceApiBasePath}/workspace/invites/:inviteId`,
      method: "DELETE",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: surfaceId,
      permission: "workspace.invites.revoke",
      meta: {
        tags: ["workspace"],
        summary: "Revoke pending invite in active workspace"
      },
      params: {
        schema: schema.params.invite,
        normalize: normalizeInviteParams
      },
      response: withStandardErrorResponses({
        200: schema.response.invites
      }),
      handler: handler("revokeWorkspaceInvite")
    }
  ];
}

function buildRoutes(controller, { workspaceSurfaceDefinitions = [] } = {}) {
  if (!controller) {
    throw new Error("Workspace routes require controller instance.");
  }

  const handler = (name) => controller[name].bind(controller);
  const workspaceSurfaces = normalizeWorkspaceSurfaceDefinitions(workspaceSurfaceDefinitions);

  const routes = [
    {
      path: "/api/bootstrap",
      method: "GET",
      auth: "public",
      meta: {
        tags: ["workspace"],
        summary: "Get startup bootstrap payload with session, app, workspace, and settings context"
      },
      response: withStandardErrorResponses({
        200: schema.response.bootstrap
      }),
      handler: handler("bootstrap")
    },
    {
      path: "/api/workspaces",
      method: "GET",
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "List workspaces visible to authenticated user"
      },
      response: withStandardErrorResponses({
        200: schema.response.workspacesList
      }),
      handler: handler("listWorkspaces")
    },
    {
      path: "/api/workspaces/select",
      method: "POST",
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "Select active workspace by slug or id"
      },
      body: {
        schema: schema.body.select,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: schema.response.select
        },
        { includeValidation400: true }
      ),
      handler: handler("selectWorkspace")
    },
    {
      path: "/api/workspace/invitations/pending",
      method: "GET",
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "List pending workspace invitations for authenticated user"
      },
      response: withStandardErrorResponses({
        200: schema.response.pendingInvites
      }),
      handler: handler("listPendingInvites")
    },
    {
      path: "/api/workspace/invitations/redeem",
      method: "POST",
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "Accept or refuse a workspace invitation using an invite token"
      },
      body: {
        schema: schema.body.redeemInvite,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: schema.response.respondToInvite
        },
        { includeValidation400: true }
      ),
      handler: handler("respondToPendingInviteByToken")
    }
  ];

  for (const workspaceSurface of workspaceSurfaces) {
    routes.push(
      ...createWorkspaceAdminRoutes({
        handler,
        surfaceId: workspaceSurface.id,
        surfacePrefix: workspaceSurface.prefix
      })
    );
  }

  return routes;
}

export { buildRoutes };
