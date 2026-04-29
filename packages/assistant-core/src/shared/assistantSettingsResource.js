import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";

const MAX_SYSTEM_PROMPT_CHARS = 12_000;

const assistantConfigRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: ["targetSurfaceId", "scopeKey", "workspaceId", "settings"],
  properties: {
    targetSurfaceId: {
      type: "string",
      minLength: 1,
      maxLength: 64
    },
    scopeKey: {
      type: "string",
      minLength: 1,
      maxLength: 160
    },
    workspaceId: {
      anyOf: [
        { type: "string", minLength: 1, pattern: RECORD_ID_PATTERN },
        { type: "null" }
      ]
    },
    settings: {
      type: "object",
      additionalProperties: false,
      required: ["systemPrompt"],
      properties: {
        systemPrompt: {
          type: "string",
          maxLength: MAX_SYSTEM_PROMPT_CHARS
        }
      }
    }
  }
};

const assistantConfigPatchSchema = createSchema({
  systemPrompt: {
    type: "string",
    required: false,
    maxLength: MAX_SYSTEM_PROMPT_CHARS,
    messages: {
      maxLength: `Assistant system prompt must be at most ${MAX_SYSTEM_PROMPT_CHARS} characters.`,
      default: "Assistant system prompt must be valid text."
    }
  }
});

const assistantConfigResource = deepFreeze({
  namespace: "assistantConfig",
  operations: {
    view: {
      method: "GET",
      output: {
        schema: assistantConfigRecordSchema
      }
    },
    patch: {
      method: "PATCH",
      body: {
        schema: assistantConfigPatchSchema,
        mode: "patch"
      },
      output: {
        schema: assistantConfigRecordSchema
      }
    }
  }
});

export {
  MAX_SYSTEM_PROMPT_CHARS,
  assistantConfigResource
};
