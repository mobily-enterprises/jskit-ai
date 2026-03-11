import { Type } from "typebox";
import { createOperationMessages } from "../contracts/contractUtils.js";
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

const workspaceMemberRecordSchema = Type.Object(
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

const workspaceMemberCreateSchema = Type.Object(
  {
    userId: Type.Integer({ minimum: 1 }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const workspaceMemberReplaceSchema = workspaceMemberCreateSchema;
const workspaceMemberPatchSchema = Type.Partial(workspaceMemberCreateSchema, {
  additionalProperties: false
});

const workspaceMemberListSchema = Type.Object(
  {
    workspace: workspaceResource.operations.view.output.schema,
    members: Type.Array(workspaceMemberRecordSchema),
    roleCatalog: roleCatalogSchema
  },
  { additionalProperties: false }
);

const WORKSPACE_MEMBER_OPERATION_MESSAGES = createOperationMessages();

const workspaceMemberResource = Object.freeze({
  resource: "workspaceMember",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: WORKSPACE_MEMBER_OPERATION_MESSAGES,
      response: Object.freeze({
        schema: workspaceMemberRecordSchema
      })
    }),
    list: Object.freeze({
      method: "GET",
      messages: WORKSPACE_MEMBER_OPERATION_MESSAGES,
      response: Object.freeze({
        schema: workspaceMemberListSchema
      })
    }),
    create: Object.freeze({
      method: "POST",
      messages: WORKSPACE_MEMBER_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: workspaceMemberCreateSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: workspaceMemberRecordSchema
      })
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: WORKSPACE_MEMBER_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: workspaceMemberReplaceSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: workspaceMemberRecordSchema
      })
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: WORKSPACE_MEMBER_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: workspaceMemberPatchSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: workspaceMemberRecordSchema
      })
    })
  })
});

export {
  workspaceMemberRecordSchema,
  workspaceMemberCreateSchema,
  workspaceMemberReplaceSchema,
  workspaceMemberPatchSchema,
  workspaceMemberListSchema,
  workspaceMemberResource
};
