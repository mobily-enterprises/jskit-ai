import { Type } from "@fastify/type-provider-typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { roleCatalogSchema } from "../../shared/contracts/resources/workspaceSchema.js";
import { workspaceInviteSchema } from "../../shared/contracts/resources/workspaceInviteSchema.js";
import { workspaceMemberSchema } from "../../shared/contracts/resources/workspaceMemberSchema.js";
import {
  createWorkspaceInvitesOutput,
  createWorkspaceMembersOutput
} from "./workspaceMembersOutput.js";

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeWorkspaceScopeInput(input = {}) {
  const source = normalizeObjectInput(input);
  const normalized = {};

  if (Object.hasOwn(source, "workspaceSlug")) {
    normalized.workspaceSlug = normalizeText(source.workspaceSlug).toLowerCase();
  }

  return normalized;
}

function normalizeWorkspaceMemberRoleBody(body = {}) {
  const source = normalizeObjectInput(body);
  return {
    roleId: normalizeText(source.roleId).toLowerCase()
  };
}

function normalizeWorkspaceMemberRoleInput(input = {}) {
  const source = normalizeObjectInput(input);
  const normalized = normalizeWorkspaceScopeInput(source);

  normalized.memberUserId = toPositiveInteger(source.memberUserId);
  normalized.roleId = normalizeText(source.roleId).toLowerCase();

  return normalized;
}

function normalizeWorkspaceInviteCreateBody(body = {}) {
  const source = normalizeObjectInput(body);
  return {
    email: normalizeText(source.email).toLowerCase(),
    roleId: normalizeText(source.roleId || "member").toLowerCase() || "member"
  };
}

function normalizeWorkspaceInviteCreateInput(input = {}) {
  const source = normalizeObjectInput(input);
  return {
    ...normalizeWorkspaceScopeInput(source),
    ...normalizeWorkspaceInviteCreateBody(source)
  };
}

function normalizeWorkspaceInviteRevokeInput(input = {}) {
  const source = normalizeObjectInput(input);
  const normalized = normalizeWorkspaceScopeInput(source);

  normalized.inviteId = toPositiveInteger(source.inviteId);

  return normalized;
}

const workspaceScopeActionInput = Object.freeze({
  schema: Type.Object(
    {
      workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
    },
    { additionalProperties: false }
  ),
  normalize: normalizeWorkspaceScopeInput
});

const workspaceMemberRoleUpdateBody = Object.freeze({
  schema: Type.Object(
    {
      roleId: workspaceMemberSchema.operations.patch.body.schema.properties.roleId
    },
    { additionalProperties: false }
  ),
  normalize: normalizeWorkspaceMemberRoleBody
});

const workspaceMemberRoleUpdateActionInput = Object.freeze({
  schema: Type.Object(
    {
      workspaceSlug: Type.Optional(Type.String({ minLength: 1 })),
      memberUserId: Type.Integer({ minimum: 1 }),
      roleId: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  ),
  normalize: normalizeWorkspaceMemberRoleInput
});

const workspaceInviteCreateBody = Object.freeze({
  schema: workspaceInviteSchema.operations.create.body.schema,
  normalize: normalizeWorkspaceInviteCreateBody
});

const workspaceInviteCreateActionInput = Object.freeze({
  schema: Type.Object(
    {
      workspaceSlug: Type.Optional(Type.String({ minLength: 1 })),
      email: Type.String({ minLength: 3, format: "email" }),
      roleId: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  ),
  normalize: normalizeWorkspaceInviteCreateInput
});

const workspaceInviteRevokeActionInput = Object.freeze({
  schema: Type.Object(
    {
      workspaceSlug: Type.Optional(Type.String({ minLength: 1 })),
      inviteId: Type.Integer({ minimum: 1 })
    },
    { additionalProperties: false }
  ),
  normalize: normalizeWorkspaceInviteRevokeInput
});

const workspaceRoleCatalogOutput = Object.freeze({
  schema: roleCatalogSchema
});

const workspaceMembersOutput = Object.freeze({
  schema: workspaceMemberSchema.operations.list.response.schema,
  normalize: createWorkspaceMembersOutput
});

const workspaceInvitesOutput = Object.freeze({
  schema: workspaceInviteSchema.operations.list.response.schema,
  normalize: createWorkspaceInvitesOutput
});

export {
  workspaceScopeActionInput,
  workspaceMemberRoleUpdateBody,
  workspaceMemberRoleUpdateActionInput,
  workspaceInviteCreateBody,
  workspaceInviteCreateActionInput,
  workspaceInviteRevokeActionInput,
  workspaceRoleCatalogOutput,
  workspaceMembersOutput,
  workspaceInvitesOutput
};
