import { Type } from "typebox";
import {
  createCursorListValidator,
  normalizeObjectInput,
  recordIdInputSchema,
  recordIdSchema
} from "@jskit-ai/kernel/shared/validators";
import {
  normalizeBoolean,
  normalizeIfPresent,
  normalizeLowerText,
  normalizeRecordId,
  normalizeText,
  normalizeOrNull
} from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeDbRecordId, toIsoString, toNullableDateTime } from "@jskit-ai/database-runtime/shared";

function normalizeWorkspaceRecord(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: normalizeIfPresent(source.id, (value) => normalizeDbRecordId(value, { fallback: null })),
    slug: normalizeLowerText(source.slug),
    name: normalizeText(source.name),
    ownerUserId: normalizeIfPresent(
      source.ownerUserId ?? source.owner_user_id,
      (value) => normalizeDbRecordId(value, { fallback: null })
    ),
    isPersonal: normalizeBoolean(source.isPersonal ?? source.is_personal),
    avatarUrl: normalizeText(source.avatarUrl ?? source.avatar_url),
    createdAt: normalizeIfPresent(source.createdAt ?? source.created_at, toIsoString),
    updatedAt: normalizeIfPresent(source.updatedAt ?? source.updated_at, toIsoString),
    deletedAt: normalizeOrNull(source.deletedAt ?? source.deleted_at, toIsoString)
  };
}

function normalizeWorkspaceInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "slug")) {
    normalized.slug = normalizeLowerText(source.slug);
  }
  if (Object.hasOwn(source, "name")) {
    normalized.name = normalizeText(source.name);
  }
  if (Object.hasOwn(source, "ownerUserId")) {
    normalized.ownerUserId = normalizeRecordId(source.ownerUserId, { fallback: "" });
  }
  if (Object.hasOwn(source, "isPersonal")) {
    normalized.isPersonal = normalizeBoolean(source.isPersonal);
  }
  if (Object.hasOwn(source, "avatarUrl")) {
    normalized.avatarUrl = normalizeText(source.avatarUrl);
  }
  if (Object.hasOwn(source, "deletedAt")) {
    normalized.deletedAt = toNullableDateTime(source.deletedAt);
  }

  return normalized;
}

const recordOutputSchema = Type.Object(
  {
    id: recordIdSchema,
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    ownerUserId: recordIdSchema,
    isPersonal: Type.Boolean(),
    avatarUrl: Type.String(),
    createdAt: Type.String({ format: "date-time", minLength: 1 }),
    updatedAt: Type.String({ format: "date-time", minLength: 1 }),
    deletedAt: Type.Union([Type.String({ format: "date-time", minLength: 1 }), Type.Null()])
  },
  { additionalProperties: false }
);

const createBodySchema = Type.Object(
  {
    slug: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    ownerUserId: recordIdInputSchema,
    isPersonal: Type.Optional(Type.Boolean()),
    avatarUrl: Type.Optional(Type.String({ maxLength: 512 }))
  },
  {
    additionalProperties: false,
    required: []
  }
);

const patchBodySchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    avatarUrl: Type.Optional(Type.String({ maxLength: 512 })),
    deletedAt: Type.Optional(Type.Union([Type.String({ format: "date-time", minLength: 1 }), Type.Null()]))
  },
  {
    additionalProperties: false
  }
);

const recordOutputValidator = Object.freeze({
  schema: recordOutputSchema,
  normalize: normalizeWorkspaceRecord
});

const createBodyValidator = Object.freeze({
  schema: createBodySchema,
  normalize: normalizeWorkspaceInput
});

const patchBodyValidator = Object.freeze({
  schema: patchBodySchema,
  normalize: normalizeWorkspaceInput
});

const workspacesResource = Object.freeze({
  namespace: "workspaces",
  tableName: "workspaces",
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
      key: "ownerUserId",
      repository: { column: "owner_user_id" }
    }),
    Object.freeze({
      key: "isPersonal",
      repository: { column: "is_personal" }
    }),
    Object.freeze({
      key: "avatarUrl",
      repository: { column: "avatar_url" }
    }),
    Object.freeze({
      key: "createdAt",
      repository: { column: "created_at" }
    }),
    Object.freeze({
      key: "updatedAt",
      repository: { column: "updated_at" }
    }),
    Object.freeze({
      key: "deletedAt",
      repository: { column: "deleted_at" }
    })
  ])
});

export { workspacesResource };
