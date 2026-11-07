import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { defineApiContract } from "@jskit-ai/resource-core/shared/apiContract";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { OPERATION_MESSAGES } from "../operationMessages.js";
import { userProfileOutputSchema } from "./accountSettingsSchemas.js";
import { userSettingsOutputSchema } from "./userSettingsResource.js";
import { USERNAME_MAX_LENGTH, normalizeNullableString, normalizeNullableVersion, normalizeUsername } from "./userProfileValues.js";

// Each field message: its English and the code a client renders it from in the user's language.
const USER_PROFILE_FIELD_MESSAGES = deepFreeze({
  avatarStreamMissing: { code: "users.avatar.streamMissing", message: "Avatar stream is missing." },
  avatarMimeTypeInvalid: { code: "users.avatar.mimeTypeInvalid", message: "Avatar mimeType is invalid." },
  avatarFileNameInvalid: { code: "users.avatar.fileNameInvalid", message: "Avatar fileName is invalid." },
  avatarUploadDimensionInvalid: {
    code: "users.avatar.uploadDimensionInvalid",
    message: "Avatar uploadDimension is invalid."
  }
});

const userProfileBodySchema = createSchema({
  displayName: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 120
  }
});

const avatarUploadBodySchema = createSchema({
  stream: {
    type: "none",
    required: true,
    messages: {
      default: USER_PROFILE_FIELD_MESSAGES.avatarStreamMissing
    }
  },
  mimeType: {
    type: "string",
    required: false,
    minLength: 1,
    messages: {
      default: USER_PROFILE_FIELD_MESSAGES.avatarMimeTypeInvalid
    }
  },
  fileName: {
    type: "string",
    required: false,
    minLength: 1,
    messages: {
      default: USER_PROFILE_FIELD_MESSAGES.avatarFileNameInvalid
    }
  },
  uploadDimension: {
    type: "string",
    required: false,
    minLength: 1,
    messages: {
      default: USER_PROFILE_FIELD_MESSAGES.avatarUploadDimensionInvalid
    }
  }
});

// The users table.
const userProfileResource = defineTableResource({
  name: "userProfiles",
  tableName: "users",
  searchSchema: {
    id: { type: "id", actualField: "id" },
    usernames: { type: "array", actualField: "username", filterOperator: "in", items: { type: "string" } }
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
        writeSerializer: "datetime-utc"
      }
    },
    createdAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "created_at",
        writeSerializer: "datetime-utc"
      }
    },
    updatedAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "updated_at",
        writeSerializer: "datetime-utc"
      }
    }
  },
});

// The signed-in user's profile over HTTP.
const userProfileContract = defineApiContract({
  namespace: "userProfile",
  messages: OPERATION_MESSAGES,
  operations: {
    patch: {
      method: "PATCH",
      body: userProfileBodySchema,
      output: userProfileOutputSchema
    },
    avatarUpload: {
      method: "POST",
      body: avatarUploadBodySchema,
      output: userSettingsOutputSchema
    },
    avatarDelete: {
      method: "DELETE",
      body: createSchema({}),
      output: userSettingsOutputSchema
    }
  }
});

export { userProfileContract, userProfileResource };
