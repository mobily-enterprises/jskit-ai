import { createSchema } from "json-rest-schema";
import {
  createCursorListValidator,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

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

const workspaceOutputValidator = deepFreeze({
  schema: workspaceOutputSchema,
  mode: "replace"
});

const workspaceListItemOutputValidator = deepFreeze({
  schema: workspaceListItemSchema,
  mode: "replace"
});

const resource = deepFreeze({
  namespace: "workspace",
  messages: {
    validation: "Fix invalid workspace values and try again.",
    saveSuccess: "Workspace updated.",
    saveError: "Unable to update workspace.",
    apiValidation: "Validation failed."
  },
  operations: {
    view: {
      method: "GET",
      output: workspaceOutputValidator
    },
    list: {
      method: "GET",
      output: createCursorListValidator(workspaceListItemOutputValidator)
    },
    create: {
      method: "POST",
      body: {
        schema: workspaceCreateBodySchema,
        mode: "create"
      },
      output: workspaceOutputValidator
    },
    replace: {
      method: "PUT",
      body: {
        schema: workspaceCreateBodySchema,
        mode: "replace"
      },
      output: workspaceOutputValidator
    },
    patch: {
      method: "PATCH",
      body: {
        schema: workspacePatchBodySchema,
        mode: "patch"
      },
      output: workspaceOutputValidator
    }
  }
});

export { resource as workspaceResource };
export { workspaceListItemOutputValidator };
