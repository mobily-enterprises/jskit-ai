import { Type } from "typebox";
import {
  buildResourceRequiredMetadata,
  normalizeObjectInput
} from "../contractUtils.js";

const workspaceSummarySchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    color: Type.String({ minLength: 7, maxLength: 7 }),
    avatarUrl: Type.String(),
    roleId: Type.String({ minLength: 1 }),
    isAccessible: Type.Boolean()
  },
  { additionalProperties: false }
);

const workspaceAdminSummarySchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    ownerUserId: Type.Integer({ minimum: 1 }),
    avatarUrl: Type.String(),
    color: Type.String({ minLength: 7, maxLength: 7 })
  },
  { additionalProperties: false }
);

const membershipSummarySchema = Type.Object(
  {
    workspaceId: Type.Integer({ minimum: 1 }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const roleCatalogSchema = Type.Object(
  {
    collaborationEnabled: Type.Boolean(),
    defaultInviteRole: Type.String({ minLength: 1 }),
    roles: Type.Array(Type.Object({}, { additionalProperties: true })),
    assignableRoleIds: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
);

const workspaceCreateSchema = Type.Object(
  {
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    ownerUserId: Type.Integer({ minimum: 1 }),
    avatarUrl: Type.String(),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
    isPersonal: Type.Boolean()
  },
  { additionalProperties: false }
);

const workspaceReplaceSchema = workspaceCreateSchema;
const workspacePatchSchema = Type.Partial(workspaceCreateSchema, {
  additionalProperties: false
});

const workspaceListSchema = Type.Object(
  {
    workspaces: Type.Array(workspaceSummarySchema)
  },
  { additionalProperties: false }
);

const workspaceSchema = Object.freeze({
  resource: "workspace",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      response: Object.freeze({
        schema: workspaceAdminSummarySchema
      })
    }),
    list: Object.freeze({
      method: "GET",
      response: Object.freeze({
        schema: workspaceListSchema
      })
    }),
    create: Object.freeze({
      method: "POST",
      body: Object.freeze({
        schema: workspaceCreateSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: workspaceAdminSummarySchema
      })
    }),
    replace: Object.freeze({
      method: "PUT",
      body: Object.freeze({
        schema: workspaceReplaceSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: workspaceAdminSummarySchema
      })
    }),
    patch: Object.freeze({
      method: "PATCH",
      body: Object.freeze({
        schema: workspacePatchSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: workspaceAdminSummarySchema
      })
    })
  }),
  listItem: workspaceSummarySchema,
  required: buildResourceRequiredMetadata({
    create: workspaceCreateSchema,
    replace: workspaceReplaceSchema,
    patch: workspacePatchSchema
  })
});

export {
  workspaceSummarySchema,
  workspaceAdminSummarySchema,
  membershipSummarySchema,
  roleCatalogSchema,
  workspaceCreateSchema,
  workspaceReplaceSchema,
  workspacePatchSchema,
  workspaceListSchema,
  workspaceSchema
};
