import { Type } from "typebox";
import { createOperationMessages } from "../operationMessages.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { workspaceResource } from "./workspaceResource.js";

const roleCatalogSchema = Type.Object(
  {
    collaborationEnabled: Type.Boolean(),
    defaultInviteRole: Type.String(),
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
    workspace: workspaceResource.operations.view.outputValidator.schema,
    members: Type.Array(workspaceMemberRecordSchema),
    roleCatalog: roleCatalogSchema
  },
  { additionalProperties: false }
);

const workspaceMemberOutputValidator = Object.freeze({
  schema: workspaceMemberRecordSchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      userId: Number(source.userId),
      roleId: String(source.roleId || ""),
      status: String(source.status || ""),
      displayName: String(source.displayName || ""),
      email: String(source.email || ""),
      isOwner: source.isOwner === true
    };
  }
});

const workspaceMemberListOutputValidator = Object.freeze({
  schema: workspaceMemberListSchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      workspace: workspaceResource.operations.view.outputValidator.normalize(source.workspace),
      members: Array.isArray(source.members)
        ? source.members.map((entry) => workspaceMemberOutputValidator.normalize(entry))
        : [],
      roleCatalog: normalizeObjectInput(source.roleCatalog)
    };
  }
});

const WORKSPACE_MEMBER_OPERATION_MESSAGES = createOperationMessages();

const workspaceMemberResource = Object.freeze({
  resource: "workspaceMember",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: WORKSPACE_MEMBER_OPERATION_MESSAGES,
      outputValidator: workspaceMemberOutputValidator
    }),
    list: Object.freeze({
      method: "GET",
      messages: WORKSPACE_MEMBER_OPERATION_MESSAGES,
      outputValidator: workspaceMemberListOutputValidator
    }),
    create: Object.freeze({
      method: "POST",
      messages: WORKSPACE_MEMBER_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        schema: workspaceMemberCreateSchema,
        normalize: normalizeObjectInput
      }),
      outputValidator: workspaceMemberOutputValidator
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: WORKSPACE_MEMBER_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        schema: workspaceMemberReplaceSchema,
        normalize: normalizeObjectInput
      }),
      outputValidator: workspaceMemberOutputValidator
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: WORKSPACE_MEMBER_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        schema: workspaceMemberPatchSchema,
        normalize: normalizeObjectInput
      }),
      outputValidator: workspaceMemberOutputValidator
    })
  })
});

export { workspaceMemberResource };
