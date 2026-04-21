import { Type } from "typebox";
import {
  createCursorListValidator,
  normalizeObjectInput,
  recordIdInputSchema,
  recordIdSchema
} from "@jskit-ai/kernel/shared/validators";
import {
  normalizeIfPresent,
  normalizeLowerText,
  normalizeRecordId
} from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeDbRecordId, toIsoString } from "@jskit-ai/database-runtime/shared";

function normalizeMembershipRecord(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: normalizeIfPresent(source.id, (value) => normalizeDbRecordId(value, { fallback: null })),
    workspaceId: normalizeIfPresent(
      source.workspaceId ?? source.workspace_id,
      (value) => normalizeDbRecordId(value, { fallback: null })
    ),
    userId: normalizeIfPresent(
      source.userId ?? source.user_id,
      (value) => normalizeDbRecordId(value, { fallback: null })
    ),
    roleSid: normalizeLowerText(source.roleSid ?? source.role_sid ?? "member") || "member",
    status: normalizeLowerText(source.status ?? "active") || "active",
    createdAt: normalizeIfPresent(source.createdAt ?? source.created_at, toIsoString),
    updatedAt: normalizeIfPresent(source.updatedAt ?? source.updated_at, toIsoString)
  };
}

function normalizeMembershipInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "workspaceId")) {
    normalized.workspaceId = normalizeRecordId(source.workspaceId, { fallback: "" });
  }
  if (Object.hasOwn(source, "userId")) {
    normalized.userId = normalizeRecordId(source.userId, { fallback: "" });
  }
  if (Object.hasOwn(source, "roleSid")) {
    normalized.roleSid = normalizeLowerText(source.roleSid);
  }
  if (Object.hasOwn(source, "status")) {
    normalized.status = normalizeLowerText(source.status);
  }

  return normalized;
}

const recordOutputSchema = Type.Object(
  {
    id: recordIdSchema,
    workspaceId: recordIdSchema,
    userId: recordIdSchema,
    roleSid: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    createdAt: Type.String({ format: "date-time", minLength: 1 }),
    updatedAt: Type.String({ format: "date-time", minLength: 1 })
  },
  { additionalProperties: false }
);

const createBodySchema = Type.Object(
  {
    workspaceId: recordIdInputSchema,
    userId: recordIdInputSchema,
    roleSid: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    status: Type.Optional(Type.String({ minLength: 1, maxLength: 32 }))
  },
  {
    additionalProperties: false,
    required: []
  }
);

const patchBodySchema = Type.Object(
  {
    roleSid: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    status: Type.Optional(Type.String({ minLength: 1, maxLength: 32 }))
  },
  {
    additionalProperties: false
  }
);

const recordOutputValidator = Object.freeze({
  schema: recordOutputSchema,
  normalize: normalizeMembershipRecord
});

const createBodyValidator = Object.freeze({
  schema: createBodySchema,
  normalize: normalizeMembershipInput
});

const patchBodyValidator = Object.freeze({
  schema: patchBodySchema,
  normalize: normalizeMembershipInput
});

const workspaceMembershipsResource = Object.freeze({
  namespace: "workspaceMemberships",
  tableName: "workspace_memberships",
  idColumn: "id",
  operations: Object.freeze({
    list: Object.freeze({
      method: "GET",
      outputValidator: createCursorListValidator(recordOutputValidator)
    }),
    view: Object.freeze({
      method: "GET",
      outputValidator: recordOutputValidator
    }),
    create: Object.freeze({
      method: "POST",
      bodyValidator: createBodyValidator,
      outputValidator: recordOutputValidator
    }),
    patch: Object.freeze({
      method: "PATCH",
      bodyValidator: patchBodyValidator,
      outputValidator: recordOutputValidator
    })
  }),
  fieldMeta: Object.freeze([
    Object.freeze({
      key: "workspaceId",
      repository: { column: "workspace_id" }
    }),
    Object.freeze({
      key: "userId",
      repository: { column: "user_id" }
    }),
    Object.freeze({
      key: "roleSid",
      repository: { column: "role_sid" }
    }),
    Object.freeze({
      key: "createdAt",
      repository: { column: "created_at" }
    }),
    Object.freeze({
      key: "updatedAt",
      repository: { column: "updated_at" }
    })
  ])
});

export { workspaceMembershipsResource };
