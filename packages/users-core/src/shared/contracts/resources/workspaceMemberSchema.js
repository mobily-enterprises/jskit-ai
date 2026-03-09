import { Type } from "typebox";
import {
  buildResourceRequiredMetadata,
  normalizeObjectInput
} from "../contractUtils.js";
import {
  roleCatalogSchema,
  workspaceAdminSummarySchema
} from "./workspaceSchema.js";

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
    workspace: workspaceAdminSummarySchema,
    members: Type.Array(workspaceMemberRecordSchema),
    roleCatalog: roleCatalogSchema
  },
  { additionalProperties: false }
);

const workspaceMemberSchema = Object.freeze({
  resource: "workspaceMember",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      response: Object.freeze({
        schema: workspaceMemberRecordSchema
      })
    }),
    list: Object.freeze({
      method: "GET",
      response: Object.freeze({
        schema: workspaceMemberListSchema
      })
    }),
    create: Object.freeze({
      method: "POST",
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
      body: Object.freeze({
        schema: workspaceMemberPatchSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: workspaceMemberRecordSchema
      })
    })
  }),
  required: buildResourceRequiredMetadata({
    create: workspaceMemberCreateSchema,
    replace: workspaceMemberReplaceSchema,
    patch: workspaceMemberPatchSchema
  })
});

export {
  workspaceMemberRecordSchema,
  workspaceMemberCreateSchema,
  workspaceMemberReplaceSchema,
  workspaceMemberPatchSchema,
  workspaceMemberListSchema,
  workspaceMemberSchema
};
