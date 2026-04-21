import { Type } from "typebox";
import { normalizeDbRecordId, toIsoString, toNullableDateTime } from "@jskit-ai/database-runtime/shared";
import {
  createCursorListValidator,
  normalizeObjectInput,
  recordIdSchema
} from "@jskit-ai/kernel/shared/validators";
import {
  normalizeIfPresent,
  normalizeLowerText,
  normalizeText,
  normalizeOrNull
} from "@jskit-ai/kernel/shared/support/normalize";

const USERNAME_MAX_LENGTH = 120;

function normalizeUsername(value) {
  const normalized = normalizeLowerText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, USERNAME_MAX_LENGTH);

  return normalized || "";
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeText(value);
}

function normalizeNullableVersion(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value);
}

function normalizeProfileRecord(payload = {}) {
  const source = normalizeObjectInput(payload);
  const id = normalizeIfPresent(source.id, (value) => normalizeDbRecordId(value, { fallback: null }));
  const displayName = normalizeText(source.displayName ?? source.display_name);
  const email = normalizeLowerText(source.email);
  const username = normalizeUsername(source.username);

  return {
    id,
    authProvider: normalizeLowerText(source.authProvider ?? source.auth_provider),
    authProviderUserSid: normalizeText(source.authProviderUserSid ?? source.auth_provider_user_sid),
    email,
    username,
    displayName,
    avatarStorageKey: normalizeOrNull(source.avatarStorageKey ?? source.avatar_storage_key, normalizeNullableString),
    avatarVersion: normalizeNullableVersion(source.avatarVersion ?? source.avatar_version),
    avatarUpdatedAt: normalizeOrNull(source.avatarUpdatedAt ?? source.avatar_updated_at, toIsoString),
    createdAt: normalizeIfPresent(source.createdAt ?? source.created_at, toIsoString)
  };
}

function normalizeCreatePayload(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "authProvider") || Object.hasOwn(source, "provider")) {
    normalized.authProvider = normalizeLowerText(source.authProvider ?? source.provider);
  }
  if (Object.hasOwn(source, "authProviderUserSid") || Object.hasOwn(source, "providerUserId")) {
    normalized.authProviderUserSid = normalizeText(source.authProviderUserSid ?? source.providerUserId);
  }
  if (Object.hasOwn(source, "email")) {
    normalized.email = normalizeLowerText(source.email);
  }
  if (Object.hasOwn(source, "username")) {
    normalized.username = normalizeUsername(source.username);
  }
  if (Object.hasOwn(source, "displayName")) {
    normalized.displayName = normalizeText(source.displayName);
  }
  if (Object.hasOwn(source, "avatarStorageKey")) {
    normalized.avatarStorageKey = normalizeNullableString(source.avatarStorageKey);
  }
  if (Object.hasOwn(source, "avatarVersion")) {
    normalized.avatarVersion = normalizeNullableVersion(source.avatarVersion);
  }
  if (Object.hasOwn(source, "avatarUpdatedAt")) {
    normalized.avatarUpdatedAt = toNullableDateTime(source.avatarUpdatedAt);
  }

  return normalized;
}

const recordOutputSchema = Type.Object(
  {
    id: recordIdSchema,
    authProvider: Type.String({ minLength: 1 }),
    authProviderUserSid: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1 }),
    username: Type.String({ minLength: 1 }),
    displayName: Type.String({ minLength: 1 }),
    avatarStorageKey: Type.Union([Type.String(), Type.Null()]),
    avatarVersion: Type.Union([Type.String(), Type.Null()]),
    avatarUpdatedAt: Type.Union([Type.String({ format: "date-time", minLength: 1 }), Type.Null()]),
    createdAt: Type.String({ format: "date-time", minLength: 1 })
  },
  { additionalProperties: false }
);

const createBodySchema = Type.Object(
  {
    authProvider: Type.String({ minLength: 1, maxLength: 64 }),
    authProviderUserSid: Type.String({ minLength: 1, maxLength: 191 }),
    email: Type.String({ minLength: 1, maxLength: 255 }),
    username: Type.Optional(Type.String({ minLength: 1, maxLength: USERNAME_MAX_LENGTH })),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    avatarStorageKey: Type.Optional(Type.Union([Type.String({ maxLength: 512 }), Type.Null()])),
    avatarVersion: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
    avatarUpdatedAt: Type.Optional(Type.Union([Type.String({ format: "date-time", minLength: 1 }), Type.Null()]))
  },
  {
    additionalProperties: false,
    required: []
  }
);

const patchBodySchema = Type.Partial(createBodySchema, {
  additionalProperties: false
});

const recordOutputValidator = Object.freeze({
  schema: recordOutputSchema,
  normalize: normalizeProfileRecord
});

const createBodyValidator = Object.freeze({
  schema: createBodySchema,
  normalize: normalizeCreatePayload
});

const patchBodyValidator = Object.freeze({
  schema: patchBodySchema,
  normalize: normalizeCreatePayload
});

const resource = Object.freeze({
  namespace: "userProfiles",
  tableName: "users",
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
      key: "authProvider",
      repository: { column: "auth_provider" }
    }),
    Object.freeze({
      key: "authProviderUserSid",
      repository: { column: "auth_provider_user_sid" }
    }),
    Object.freeze({
      key: "displayName",
      repository: { column: "display_name" }
    }),
    Object.freeze({
      key: "avatarStorageKey",
      repository: { column: "avatar_storage_key" }
    }),
    Object.freeze({
      key: "avatarVersion",
      repository: { column: "avatar_version" }
    }),
    Object.freeze({
      key: "avatarUpdatedAt",
      repository: { column: "avatar_updated_at" }
    }),
    Object.freeze({
      key: "createdAt",
      repository: { column: "created_at" }
    })
  ])
});

export { resource };
