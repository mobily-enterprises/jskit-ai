import { createSchema } from "json-rest-schema";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { createOperationMessages } from "../operationMessages.js";
import { userProfileOutputSchema } from "./accountSettingsSchemas.js";
import { userSettingsOutputSchema } from "./userSettingsResource.js";

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
      default: "Avatar stream is missing."
    }
  },
  mimeType: {
    type: "string",
    required: false,
    minLength: 1,
    messages: {
      default: "Avatar mimeType is invalid."
    }
  },
  fileName: {
    type: "string",
    required: false,
    minLength: 1,
    messages: {
      default: "Avatar fileName is invalid."
    }
  },
  uploadDimension: {
    type: "string",
    required: false,
    minLength: 1,
    messages: {
      default: "Avatar uploadDimension is invalid."
    }
  }
});

const USER_PROFILE_OPERATION_MESSAGES = createOperationMessages();

const userProfileResource = defineCrudResource({
  namespace: "userProfile",
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
    }
  },
  messages: USER_PROFILE_OPERATION_MESSAGES,
  crudOperations: ["view", "list", "create", "replace", "patch"],
  crud: {
    output: userProfileOutputSchema,
    body: userProfileBodySchema
  },
  operations: {
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

export { userProfileResource };
