import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeWorkspaceAvatarUrl(value) {
  const avatarUrl = normalizeText(value);
  if (!avatarUrl) {
    return "";
  }
  if (!avatarUrl.startsWith("http://") && !avatarUrl.startsWith("https://")) {
    return null;
  }
  try {
    return new URL(avatarUrl).toString();
  } catch {
    return null;
  }
}

function serializeNullableDateTime(value) {
  if (value == null) {
    return null;
  }

  return toDatabaseDateTimeUtc(value);
}

const workspacesResource = Object.freeze({
  tableName: "workspaces",
  searchSchema: {
    id: { type: "id", actualField: "id" }
  },
  schema: {
    slug: {
      type: "string",
      required: true,
      max: 120,
      search: true,
      setter: (value) => normalizeLowerText(value)
    },
    name: {
      type: "string",
      required: true,
      max: 160,
      search: true,
      setter: (value) => normalizeText(value)
    },
    ownerUserId: {
      type: "id",
      required: true,
      search: true,
      belongsTo: "userProfiles",
      as: "owner",
      storage: { column: "owner_user_id" }
    },
    isPersonal: {
      type: "boolean",
      defaultTo: false,
      search: true,
      storage: { column: "is_personal" }
    },
    avatarUrl: {
      type: "string",
      max: 512,
      defaultTo: "",
      storage: { column: "avatar_url" },
      setter: (value) => normalizeWorkspaceAvatarUrl(value)
    },
    createdAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "created_at",
        serialize: serializeNullableDateTime
      }
    },
    updatedAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "updated_at",
        serialize: serializeNullableDateTime
      }
    },
    deletedAt: {
      type: "dateTime",
      nullable: true,
      search: true,
      storage: {
        column: "deleted_at",
        serialize: serializeNullableDateTime
      }
    }
  }
});

export { workspacesResource };
