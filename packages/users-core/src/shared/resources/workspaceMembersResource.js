import { Type } from "@fastify/type-provider-typebox";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { createOperationMessages } from "../operationMessages.js";
import { createWorkspaceRoleCatalog, OWNER_ROLE_ID } from "../roles.js";

function toPositiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

const workspaceSummaryOutputSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    ownerUserId: Type.Integer({ minimum: 1 }),
    avatarUrl: Type.String(),
    color: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const memberSummaryOutputSchema = Type.Object(
  {
    userId: Type.Integer({ minimum: 1 }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    displayName: Type.String(),
    email: Type.String({ minLength: 1 }),
    isOwner: Type.Boolean()
  },
  { additionalProperties: false }
);

const inviteSummaryOutputSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    email: Type.String({ minLength: 3, format: "email" }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 }),
    invitedByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])
  },
  { additionalProperties: false }
);

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

function normalizeWorkspaceOutputEnvelope(
  payload = {},
  { itemsKey, normalizeItem, includeInviteTokenPreview = false } = {}
) {
  const source = normalizeObjectInput(payload);
  const workspace = normalizeWorkspaceAdminSummary(source.workspace);
  const items = Array.isArray(source[itemsKey]) ? source[itemsKey] : [];
  const roleCatalog = normalizeObjectInput(source.roleCatalog);
  const hasRoleCatalog =
    Array.isArray(roleCatalog.roles) &&
    roleCatalog.roles.length > 0 &&
    Array.isArray(roleCatalog.assignableRoleIds);
  const normalized = {
    workspace,
    [itemsKey]: items.map((item) => normalizeItem(item, workspace)),
    roleCatalog: hasRoleCatalog ? roleCatalog : createWorkspaceRoleCatalog()
  };

  if (includeInviteTokenPreview && Object.hasOwn(source, "inviteTokenPreview")) {
    normalized.inviteTokenPreview = normalizeText(source.inviteTokenPreview);
  }

  return normalized;
}

function normalizeWorkspaceMembersOutput(payload = {}) {
  return normalizeWorkspaceOutputEnvelope(payload, {
    itemsKey: "members",
    normalizeItem: normalizeMemberSummary
  });
}

function normalizeWorkspaceInvitesOutput(payload = {}) {
  return normalizeWorkspaceOutputEnvelope(payload, {
    itemsKey: "invites",
    normalizeItem: normalizeInviteSummary,
    includeInviteTokenPreview: true
  });
}

const workspaceRoleCatalogOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      collaborationEnabled: Type.Boolean(),
      defaultInviteRole: Type.String(),
      roles: Type.Array(Type.Object({}, { additionalProperties: true })),
      assignableRoleIds: Type.Array(Type.String({ minLength: 1 }))
    },
    { additionalProperties: true }
  )
});

const workspaceMembersOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      workspace: workspaceSummaryOutputSchema,
      members: Type.Array(memberSummaryOutputSchema),
      roleCatalog: workspaceRoleCatalogOutputValidator.schema
    },
    { additionalProperties: false }
  ),
  normalize: normalizeWorkspaceMembersOutput
});

const workspaceInvitesOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      workspace: workspaceSummaryOutputSchema,
      invites: Type.Array(inviteSummaryOutputSchema),
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

const removeMemberInputValidator = Object.freeze({
  schema: Type.Object(
    {
      memberUserId: Type.Integer({ minimum: 1 })
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      memberUserId: toPositiveInteger(source.memberUserId)
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

const redeemInviteBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      token: Type.String({
        minLength: 1,
        messages: {
          required: "Invite token is required.",
          minLength: "Invite token is required.",
          default: "Invite token is invalid."
        }
      }),
      decision: Type.Union([Type.Literal("accept"), Type.Literal("refuse")], {
        messages: {
          required: "Decision is required.",
          default: "Decision must be accept or refuse."
        }
      })
    },
    {
      additionalProperties: false,
      messages: {
        additionalProperties: "Unexpected field."
      }
    }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      token: normalizeText(source.token),
      decision: normalizeLowerText(source.decision)
    };
  }
});

const redeemInviteOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      decision: Type.Union([Type.Literal("accepted"), Type.Literal("refused")])
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      decision: normalizeLowerText(source.decision)
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
      outputValidator: workspaceRoleCatalogOutputValidator
    }),
    membersList: Object.freeze({
      method: "GET",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      outputValidator: workspaceMembersOutputValidator
    }),
    updateMemberRole: Object.freeze({
      method: "PATCH",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      bodyValidator: updateMemberRoleBodyValidator,
      inputValidator: updateMemberRoleInputValidator,
      outputValidator: workspaceMembersOutputValidator
    }),
    removeMember: Object.freeze({
      method: "DELETE",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      inputValidator: removeMemberInputValidator,
      outputValidator: workspaceMembersOutputValidator
    }),
    invitesList: Object.freeze({
      method: "GET",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      outputValidator: workspaceInvitesOutputValidator
    }),
    createInvite: Object.freeze({
      method: "POST",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      bodyValidator: createInviteBodyValidator,
      outputValidator: workspaceInvitesOutputValidator
    }),
    revokeInvite: Object.freeze({
      method: "DELETE",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      inputValidator: revokeInviteInputValidator,
      outputValidator: workspaceInvitesOutputValidator
    }),
    redeemInvite: Object.freeze({
      method: "POST",
      messages: WORKSPACE_MEMBERS_MESSAGES,
      bodyValidator: redeemInviteBodyValidator,
      outputValidator: redeemInviteOutputValidator
    })
  })
});

export { workspaceMembersResource };
