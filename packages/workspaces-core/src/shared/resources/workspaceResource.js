import { createSchema } from "json-rest-schema";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { createSchemaDefinition } from "@jskit-ai/resource-core/shared/resource";

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

const workspaceOutputSchema = createSchema({
  id: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
  slug: { type: "string", required: true, minLength: 1, maxLength: 120 },
  name: { type: "string", required: true, minLength: 1, maxLength: 160 },
  ownerUserId: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
  avatarUrl: { type: "string", required: true }
});

const workspaceListItemSchema = createSchema({
  id: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
  slug: { type: "string", required: true, minLength: 1, maxLength: 120 },
  name: { type: "string", required: true, minLength: 1, maxLength: 160 },
  avatarUrl: { type: "string", required: true },
  roleSid: { type: "string", required: true, minLength: 1, maxLength: 64 },
  isAccessible: { type: "boolean", required: true }
});

const workspaceCreateBodySchema = createSchema({
  name: { type: "string", required: true, minLength: 1, maxLength: 160 },
  slug: { type: "string", required: false, lowercase: true, minLength: 1, maxLength: 120 },
  ownerUserId: { type: "id", required: false }
});

const workspacePatchBodySchema = createSchema({
  name: { type: "string", required: false, minLength: 1, maxLength: 160 },
  avatarUrl: {
    type: "string",
    required: false,
    pattern: "^(https?://.+)?$",
    messages: {
      pattern: "Workspace avatar URL must be a valid absolute URL (http:// or https://).",
      default: "Workspace avatar URL must be a valid absolute URL (http:// or https://)."
    }
  }
});

const workspaceListItemOutputValidator = createSchemaDefinition(workspaceListItemSchema, "replace");

const resource = defineCrudResource({
  namespace: "workspace",
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
    },
    deletedAt: {
      type: "dateTime",
      nullable: true,
      search: true,
      storage: {
        column: "deleted_at",
        writeSerializer: "datetime-utc"
      }
    }
  },
  messages: {
    validation: "Fix invalid workspace values and try again.",
    saveSuccess: "Workspace updated.",
    saveError: "Unable to update workspace.",
    apiValidation: "Validation failed."
  },
  crudOperations: ["view", "list", "create", "replace", "patch"],
  crud: {
    output: workspaceOutputSchema,
    listItemOutput: workspaceListItemOutputValidator,
    createBody: workspaceCreateBodySchema,
    replaceBody: workspaceCreateBodySchema,
    patchBody: workspacePatchBodySchema
  }
});

export { resource as workspaceResource };
export { workspaceListItemOutputValidator };
