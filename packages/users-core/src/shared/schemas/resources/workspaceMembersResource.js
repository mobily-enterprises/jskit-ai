import { Type } from "@fastify/type-provider-typebox";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { createOperationMessages } from "../../contracts/contractUtils.js";
import { createWorkspaceRoleCatalog, OWNER_ROLE_ID } from "../../roles.js";

function toPositiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeWorkspaceAdminSummary(workspace) {
  const source = normalizeObjectInput(workspace);

  return {
    id: Number(source.id),
    slug: normalizeText(source.slug),
    name: normalizeText(source.name),
    ownerUserId: Number(source.ownerUserId),
    avatarUrl: normalizeText(source.avatarUrl),
    color: normalizeText(source.color)
  };
}

function normalizeMemberSummary(member, workspace) {
  const source = normalizeObjectInput(member);

  return {
    userId: Number(source.userId),
    roleId: normalizeLowerText(source.roleId || "member") || "member",
    status: normalizeLowerText(source.status || "active") || "active",
    displayName: normalizeText(source.displayName),
    email: normalizeLowerText(source.email),
    isOwner:
      Number(source.userId) === Number(workspace.ownerUserId) ||
      normalizeLowerText(source.roleId) === OWNER_ROLE_ID
  };
}

function normalizeInviteSummary(invite) {
  const source = normalizeObjectInput(invite);

  return {
    id: Number(source.id),
    email: normalizeLowerText(source.email),
    roleId: normalizeLowerText(source.roleId || "member") || "member",
    status: normalizeLowerText(source.status || "pending") || "pending",
    expiresAt: source.expiresAt,
    invitedByUserId: source.invitedByUserId == null ? null : Number(source.invitedByUserId)
  };
}

function normalizeWorkspaceMembersOutput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const workspace = normalizeWorkspaceAdminSummary(source.workspace);
  const members = Array.isArray(source.members) ? source.members : [];

  return {
    workspace,
    members: members.map((member) => normalizeMemberSummary(member, workspace)),
    roleCatalog: createWorkspaceRoleCatalog()
  };
}

function normalizeWorkspaceInvitesOutput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const workspace = normalizeWorkspaceAdminSummary(source.workspace);
  const invites = Array.isArray(source.invites) ? source.invites : [];
  const normalized = {
    workspace,
    invites: invites.map((invite) => normalizeInviteSummary(invite)),
    roleCatalog: createWorkspaceRoleCatalog()
  };

  if (Object.hasOwn(source, "inviteTokenPreview")) {
    normalized.inviteTokenPreview = normalizeText(source.inviteTokenPreview);
  }

  return normalized;
}

const workspaceRoleCatalogOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      collaborationEnabled: Type.Boolean(),
      defaultInviteRole: Type.String({ minLength: 1 }),
      roles: Type.Array(Type.Object({}, { additionalProperties: true })),
      assignableRoleIds: Type.Array(Type.String({ minLength: 1 }))
    },
    { additionalProperties: true }
  )
});

const workspaceMembersOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      workspace: Type.Object(
        {
          id: Type.Integer({ minimum: 1 }),
          slug: Type.String({ minLength: 1 }),
          name: Type.String({ minLength: 1 }),
          ownerUserId: Type.Integer({ minimum: 1 }),
          avatarUrl: Type.String(),
          color: Type.String({ minLength: 1 })
        },
        { additionalProperties: false }
      ),
      members: Type.Array(
        Type.Object(
          {
            userId: Type.Integer({ minimum: 1 }),
            roleId: Type.String({ minLength: 1 }),
            status: Type.String({ minLength: 1 }),
            displayName: Type.String(),
            email: Type.String({ minLength: 1 }),
            isOwner: Type.Boolean()
          },
          { additionalProperties: false }
        )
      ),
      roleCatalog: workspaceRoleCatalogOutputValidator.schema
    },
    { additionalProperties: false }
  ),
  normalize: normalizeWorkspaceMembersOutput
});

const workspaceInvitesOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      workspace: Type.Object(
        {
          id: Type.Integer({ minimum: 1 }),
          slug: Type.String({ minLength: 1 }),
          name: Type.String({ minLength: 1 }),
          ownerUserId: Type.Integer({ minimum: 1 }),
          avatarUrl: Type.String(),
          color: Type.String({ minLength: 1 })
        },
        { additionalProperties: false }
      ),
      invites: Type.Array(
        Type.Object(
          {
            id: Type.Integer({ minimum: 1 }),
            email: Type.String({ minLength: 3, format: "email" }),
            roleId: Type.String({ minLength: 1 }),
            status: Type.String({ minLength: 1 }),
            expiresAt: Type.String({ minLength: 1 }),
            invitedByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])
          },
          { additionalProperties: false }
        )
      ),
      roleCatalog: workspaceRoleCatalogOutputValidator.schema,
      inviteTokenPreview: Type.Optional(Type.String({ minLength: 1 }))
    },
    { additionalProperties: false }
  ),
  normalize: normalizeWorkspaceInvitesOutput
});

const updateMemberRoleBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      roleId: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      roleId: normalizeLowerText(source.roleId)
    };
  }
});

const updateMemberRoleInputValidator = Object.freeze({
  schema: Type.Object(
    {
      memberUserId: Type.Integer({ minimum: 1 }),
      roleId: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      memberUserId: toPositiveInteger(source.memberUserId),
      roleId: normalizeLowerText(source.roleId)
    };
  }
});

const createInviteBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      email: Type.String({ minLength: 3, format: "email" }),
      roleId: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      email: normalizeLowerText(source.email),
      roleId: normalizeLowerText(source.roleId || "member") || "member"
    };
  }
});

const revokeInviteInputValidator = Object.freeze({
  schema: Type.Object(
    {
      inviteId: Type.Integer({ minimum: 1 })
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      inviteId: toPositiveInteger(source.inviteId)
    };
  }
});

const WORKSPACE_MEMBERS_MESSAGES = createOperationMessages();

const workspaceMembersResource = Object.freeze({
  resource: "workspaceMembers",
  messages: WORKSPACE_MEMBERS_MESSAGES,
  operations: Object.freeze({
    rolesList: Object.freeze({
      method: "GET",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      output: workspaceRoleCatalogOutputValidator
    }),
    membersList: Object.freeze({
      method: "GET",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      output: workspaceMembersOutputValidator
    }),
    updateMemberRole: Object.freeze({
      method: "PATCH",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      body: updateMemberRoleBodyValidator,
      input: updateMemberRoleInputValidator,
      output: workspaceMembersOutputValidator
    }),
    invitesList: Object.freeze({
      method: "GET",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      output: workspaceInvitesOutputValidator
    }),
    createInvite: Object.freeze({
      method: "POST",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      body: createInviteBodyValidator,
      output: workspaceInvitesOutputValidator
    }),
    revokeInvite: Object.freeze({
      method: "DELETE",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      input: revokeInviteInputValidator,
      output: workspaceInvitesOutputValidator
    })
  })
});

export { workspaceMembersResource };
