import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

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

function serializeNullableDateTime(value) {
  if (value == null) {
    return null;
  }

  return toDatabaseDateTimeUtc(value);
}

const resource = Object.freeze({
  tableName: "users",
  searchSchema: {
    id: { type: "id", actualField: "id" }
  },
  schema: {
    authProvider: {
      type: "string",
      required: true,
      max: 64,
      search: true,
      storage: { column: "auth_provider" },
      setter: (value) => normalizeLowerText(value)
    },
    authProviderUserSid: {
      type: "string",
      required: true,
      max: 191,
      search: true,
      storage: { column: "auth_provider_user_sid" },
      setter: (value) => normalizeText(value)
    },
    email: {
      type: "string",
      required: true,
      max: 255,
      search: true,
      setter: (value) => normalizeLowerText(value)
    },
    username: {
      type: "string",
      required: true,
      max: USERNAME_MAX_LENGTH,
      search: true,
      setter: (value) => normalizeUsername(value)
    },
    displayName: {
      type: "string",
      required: true,
      max: 160,
      storage: { column: "display_name" },
      setter: (value) => normalizeText(value)
    },
    avatarStorageKey: {
      type: "string",
      nullable: true,
      max: 512,
      storage: { column: "avatar_storage_key" },
      setter: (value) => normalizeNullableString(value)
    },
    avatarVersion: {
      type: "string",
      nullable: true,
      max: 64,
      storage: { column: "avatar_version" },
      setter: (value) => normalizeNullableVersion(value)
    },
    avatarUpdatedAt: {
      type: "dateTime",
      nullable: true,
      storage: {
        column: "avatar_updated_at",
        serialize: serializeNullableDateTime
      }
    },
    createdAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "created_at",
        serialize: serializeNullableDateTime
      }
    }
  }
});

export { resource };
