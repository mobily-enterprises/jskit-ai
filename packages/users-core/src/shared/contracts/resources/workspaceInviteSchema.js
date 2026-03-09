import { Type } from "typebox";
import {
  buildResourceRequiredMetadata,
  createOperationMessages,
  normalizeObjectInput
} from "../contractUtils.js";
import {
  roleCatalogSchema,
  workspaceAdminSummarySchema
} from "./workspaceSchema.js";

const workspaceInviteRecordSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    email: Type.String({ minLength: 3 }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 }),
    invitedByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])
  },
  { additionalProperties: false }
);

const workspaceInviteCreateSchema = Type.Object(
  {
    email: Type.String({ minLength: 3 }),
    roleId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const workspaceInviteReplaceSchema = Type.Object(
  {
    email: Type.String({ minLength: 3 }),
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
    workspace: workspaceAdminSummarySchema,
    invites: Type.Array(workspaceInviteRecordSchema),
    roleCatalog: roleCatalogSchema,
    inviteTokenPreview: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const WORKSPACE_INVITE_OPERATION_MESSAGES = createOperationMessages();

const workspaceInviteSchema = Object.freeze({
  resource: "workspaceInvite",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: WORKSPACE_INVITE_OPERATION_MESSAGES,
      response: Object.freeze({
        schema: workspaceInviteRecordSchema
      })
    }),
    list: Object.freeze({
      method: "GET",
      messages: WORKSPACE_INVITE_OPERATION_MESSAGES,
      response: Object.freeze({
        schema: workspaceInviteListSchema
      })
    }),
    create: Object.freeze({
      method: "POST",
      messages: WORKSPACE_INVITE_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: workspaceInviteCreateSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: workspaceInviteRecordSchema
      })
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: WORKSPACE_INVITE_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: workspaceInviteReplaceSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: workspaceInviteRecordSchema
      })
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: WORKSPACE_INVITE_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: workspaceInvitePatchSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: workspaceInviteRecordSchema
      })
    })
  }),
  required: buildResourceRequiredMetadata({
    create: workspaceInviteCreateSchema,
    replace: workspaceInviteReplaceSchema,
    patch: workspaceInvitePatchSchema
  })
});

export {
  workspaceInviteRecordSchema,
  workspaceInviteCreateSchema,
  workspaceInviteReplaceSchema,
  workspaceInvitePatchSchema,
  workspaceInviteListSchema,
  workspaceInviteSchema
};
