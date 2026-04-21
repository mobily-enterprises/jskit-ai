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
  normalizeRecordId,
  normalizeText,
  normalizeOrNull
} from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeDbRecordId, toIsoString, toNullableDateTime } from "@jskit-ai/database-runtime/shared";

function normalizeInviteRecord(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: normalizeIfPresent(source.id, (value) => normalizeDbRecordId(value, { fallback: null })),
    workspaceId: normalizeIfPresent(
      source.workspaceId ?? source.workspace_id,
      (value) => normalizeDbRecordId(value, { fallback: null })
    ),
    email: normalizeLowerText(source.email),
    roleSid: normalizeLowerText(source.roleSid ?? source.role_sid ?? "member") || "member",
    status: normalizeLowerText(source.status ?? "pending") || "pending",
    tokenHash: normalizeText(source.tokenHash ?? source.token_hash),
    invitedByUserId: normalizeOrNull(
      source.invitedByUserId ?? source.invited_by_user_id,
      (value) => normalizeDbRecordId(value, { fallback: null })
    ),
    expiresAt: normalizeOrNull(source.expiresAt ?? source.expires_at, toIsoString),
    acceptedAt: normalizeOrNull(source.acceptedAt ?? source.accepted_at, toIsoString),
    revokedAt: normalizeOrNull(source.revokedAt ?? source.revoked_at, toIsoString),
    createdAt: normalizeIfPresent(source.createdAt ?? source.created_at, toIsoString),
    updatedAt: normalizeIfPresent(source.updatedAt ?? source.updated_at, toIsoString)
  };
}

function normalizeInviteInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "workspaceId")) {
    normalized.workspaceId = normalizeRecordId(source.workspaceId, { fallback: "" });
  }
  if (Object.hasOwn(source, "email")) {
    normalized.email = normalizeLowerText(source.email);
  }
  if (Object.hasOwn(source, "roleSid")) {
    normalized.roleSid = normalizeLowerText(source.roleSid);
  }
  if (Object.hasOwn(source, "status")) {
    normalized.status = normalizeLowerText(source.status);
  }
  if (Object.hasOwn(source, "tokenHash")) {
    normalized.tokenHash = normalizeText(source.tokenHash);
  }
  if (Object.hasOwn(source, "invitedByUserId")) {
    normalized.invitedByUserId =
      source.invitedByUserId == null
        ? null
        : normalizeRecordId(source.invitedByUserId, { fallback: null });
  }
  if (Object.hasOwn(source, "expiresAt")) {
    normalized.expiresAt = toNullableDateTime(source.expiresAt);
  }
  if (Object.hasOwn(source, "acceptedAt")) {
    normalized.acceptedAt = toNullableDateTime(source.acceptedAt);
  }
  if (Object.hasOwn(source, "revokedAt")) {
    normalized.revokedAt = toNullableDateTime(source.revokedAt);
  }

  return normalized;
}

const recordOutputSchema = Type.Object(
  {
    id: recordIdSchema,
    workspaceId: recordIdSchema,
    email: Type.String({ minLength: 1 }),
    roleSid: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    tokenHash: Type.String({ minLength: 1 }),
    invitedByUserId: Type.Union([recordIdSchema, Type.Null()]),
    expiresAt: Type.Union([Type.String({ format: "date-time", minLength: 1 }), Type.Null()]),
    acceptedAt: Type.Union([Type.String({ format: "date-time", minLength: 1 }), Type.Null()]),
    revokedAt: Type.Union([Type.String({ format: "date-time", minLength: 1 }), Type.Null()]),
    createdAt: Type.String({ format: "date-time", minLength: 1 }),
    updatedAt: Type.String({ format: "date-time", minLength: 1 })
  },
  { additionalProperties: false }
);

const createBodySchema = Type.Object(
  {
    workspaceId: recordIdInputSchema,
    email: Type.String({ minLength: 1, maxLength: 255 }),
    tokenHash: Type.String({ minLength: 1, maxLength: 255 }),
    roleSid: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    status: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    invitedByUserId: Type.Optional(Type.Union([recordIdInputSchema, Type.Null()])),
    expiresAt: Type.Optional(Type.Union([Type.String({ format: "date-time", minLength: 1 }), Type.Null()]))
  },
  {
    additionalProperties: false,
    required: []
  }
);

const patchBodySchema = Type.Object(
  {
    roleSid: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    status: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    invitedByUserId: Type.Optional(Type.Union([recordIdInputSchema, Type.Null()])),
    expiresAt: Type.Optional(Type.Union([Type.String({ format: "date-time", minLength: 1 }), Type.Null()])),
    acceptedAt: Type.Optional(Type.Union([Type.String({ format: "date-time", minLength: 1 }), Type.Null()])),
    revokedAt: Type.Optional(Type.Union([Type.String({ format: "date-time", minLength: 1 }), Type.Null()]))
  },
  {
    additionalProperties: false
  }
);

const recordOutputValidator = Object.freeze({
  schema: recordOutputSchema,
  normalize: normalizeInviteRecord
});

const createBodyValidator = Object.freeze({
  schema: createBodySchema,
  normalize: normalizeInviteInput
});

const patchBodyValidator = Object.freeze({
  schema: patchBodySchema,
  normalize: normalizeInviteInput
});

const workspaceInvitesResource = Object.freeze({
  namespace: "workspaceInvites",
  tableName: "workspace_invites",
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
      key: "roleSid",
      repository: { column: "role_sid" }
    }),
    Object.freeze({
      key: "tokenHash",
      repository: { column: "token_hash" }
    }),
    Object.freeze({
      key: "invitedByUserId",
      repository: { column: "invited_by_user_id" }
    }),
    Object.freeze({
      key: "expiresAt",
      repository: { column: "expires_at" }
    }),
    Object.freeze({
      key: "acceptedAt",
      repository: { column: "accepted_at" }
    }),
    Object.freeze({
      key: "revokedAt",
      repository: { column: "revoked_at" }
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

export { workspaceInvitesResource };
