import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { createSchemaDefinition } from "@jskit-ai/resource-core/shared/apiContract";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { OPERATION_MESSAGES } from "../operationMessages.js";

// Each field message: its English and the code a client renders it from in the user's language.
const WORKSPACE_FIELD_MESSAGES = deepFreeze({
  avatarUrlInvalid: {
    code: "workspaces.workspace.avatarUrlInvalid",
    message: "Workspace avatar URL must be a valid absolute URL (http:// or https://)."
  }
});

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
  roleLabel: { type: "string", required: false },
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
      pattern: WORKSPACE_FIELD_MESSAGES.avatarUrlInvalid,
      default: WORKSPACE_FIELD_MESSAGES.avatarUrlInvalid
    }
  }
});

// The fields a workspace patch may change.
const WORKSPACE_PATCH_FIELD_KEYS = Object.freeze(["name", "avatarUrl"]);

const workspaceListItemOutputValidator = createSchemaDefinition(workspaceListItemSchema, "replace");

// The workspaces table.
const workspaceResource = defineTableResource({
  name: "workspaces",
  tableName: "workspaces",
  searchSchema: {
    id: { type: "id", actualField: "id" },
    slug: { type: "string", actualField: "slug", filterOperator: "=" },
    slugs: { type: "array", actualField: "slug", filterOperator: "in", items: { type: "string" } },
    owner: { type: "id", actualField: "owner_user_id", filterOperator: "=" },
    isPersonal: { type: "boolean", actualField: "is_personal", filterOperator: "=" }
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
  }
});

// Workspaces over HTTP: the workspace directory's routes and actions.
const workspaceCrud = defineCrudContract(workspaceResource, {
  namespace: "workspace",
  messages: {
    validation: "jskit.workspaces.feedback.workspaceInvalid",
    saveSuccess: "jskit.workspaces.feedback.workspaceUpdated",
    saveError: "jskit.workspaces.feedback.workspaceUpdateFailed",
    apiValidation: OPERATION_MESSAGES.apiValidation
  },
  operations: ["view", "list", "create", "replace", "patch"],
  output: workspaceOutputSchema,
  listItemOutput: workspaceListItemOutputValidator,
  createBody: workspaceCreateBodySchema,
  replaceBody: workspaceCreateBodySchema,
  patchBody: workspacePatchBodySchema
});

export { workspaceCrud, workspaceResource };
export { WORKSPACE_PATCH_FIELD_KEYS, workspaceListItemOutputValidator };
