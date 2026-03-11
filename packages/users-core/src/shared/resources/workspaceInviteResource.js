import { Type } from "typebox";
import { createOperationMessages } from "../contractUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { workspaceResource } from "./workspaceResource.js";

const roleCatalogSchema = Type.Object(
  {
    collaborationEnabled: Type.Boolean(),
    defaultInviteRole: Type.String({ minLength: 1 }),
    roles: Type.Array(Type.Object({}, { additionalProperties: true })),
    assignableRoleIds: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
);

const workspaceInviteRecordSchema = Type.Object(
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

const workspaceInviteCreateSchema = Type.Object(
  {
    email: Type.String({ minLength: 3, format: "email" }),
    roleId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const workspaceInviteReplaceSchema = Type.Object(
  {
    email: Type.String({ minLength: 3, format: "email" }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 }),
    invitedByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])
  },
  { additionalProperties: false }
);

const workspaceInvitePatchSchema = Type.Partial(workspaceInviteReplaceSchema, {
  additionalProperties: false
});

const workspaceInviteListSchema = Type.Object(
  {
    workspace: workspaceResource.operations.view.output.schema,
    invites: Type.Array(workspaceInviteRecordSchema),
    roleCatalog: roleCatalogSchema,
    inviteTokenPreview: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const workspaceInviteOutputValidator = Object.freeze({
  schema: workspaceInviteRecordSchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      id: Number(source.id),
      email: String(source.email || ""),
      roleId: String(source.roleId || ""),
      status: String(source.status || ""),
      expiresAt: String(source.expiresAt || ""),
      invitedByUserId: source.invitedByUserId == null ? null : Number(source.invitedByUserId)
    };
  }
});

const workspaceInviteListOutputValidator = Object.freeze({
  schema: workspaceInviteListSchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const normalized = {
      workspace: workspaceResource.operations.view.output.normalize(source.workspace),
      invites: Array.isArray(source.invites)
        ? source.invites.map((entry) => workspaceInviteOutputValidator.normalize(entry))
        : [],
      roleCatalog: normalizeObjectInput(source.roleCatalog)
    };

    if (Object.hasOwn(source, "inviteTokenPreview")) {
      normalized.inviteTokenPreview = String(source.inviteTokenPreview || "");
    }

    return normalized;
  }
});

const workspaceInviteRedeemBodyValidator = Object.freeze({
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
  normalize: normalizeObjectInput
});

const workspaceInviteRedeemOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      decision: Type.Union([Type.Literal("accepted"), Type.Literal("refused")])
    },
    { additionalProperties: false }
  ),
  normalize: normalizeObjectInput
});

const WORKSPACE_INVITE_OPERATION_MESSAGES = createOperationMessages();

const workspaceInviteResource = Object.freeze({
  resource: "workspaceInvite",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: WORKSPACE_INVITE_OPERATION_MESSAGES,
      output: workspaceInviteOutputValidator
    }),
    list: Object.freeze({
      method: "GET",
      messages: WORKSPACE_INVITE_OPERATION_MESSAGES,
      output: workspaceInviteListOutputValidator
    }),
    create: Object.freeze({
      method: "POST",
      messages: WORKSPACE_INVITE_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: workspaceInviteCreateSchema,
        normalize: normalizeObjectInput
      }),
      output: workspaceInviteOutputValidator
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: WORKSPACE_INVITE_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: workspaceInviteReplaceSchema,
        normalize: normalizeObjectInput
      }),
      output: workspaceInviteOutputValidator
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: WORKSPACE_INVITE_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: workspaceInvitePatchSchema,
        normalize: normalizeObjectInput
      }),
      output: workspaceInviteOutputValidator
    }),
    redeem: Object.freeze({
      method: "POST",
      messages: WORKSPACE_INVITE_OPERATION_MESSAGES,
      body: workspaceInviteRedeemBodyValidator,
      output: workspaceInviteRedeemOutputValidator
    })
  })
});

export { workspaceInviteResource };
