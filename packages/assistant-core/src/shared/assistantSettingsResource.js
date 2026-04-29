import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";

const MAX_SYSTEM_PROMPT_CHARS = 12_000;

const assistantConfigSettingsSchema = createSchema({
  systemPrompt: {
    type: "string",
    required: true,
    maxLength: MAX_SYSTEM_PROMPT_CHARS
  }
});

const assistantConfigRecordSchema = createSchema({
  targetSurfaceId: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 64
  },
  scopeKey: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 160
  },
  workspaceId: {
    type: "string",
    required: true,
    nullable: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  settings: {
    type: "object",
    required: true,
    schema: assistantConfigSettingsSchema
  }
});

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
        schema: assistantConfigRecordSchema,
        mode: "replace"
      }
    },
    patch: {
      method: "PATCH",
      body: {
        schema: assistantConfigPatchSchema,
        mode: "patch"
      },
      output: {
        schema: assistantConfigRecordSchema,
        mode: "replace"
      }
    }
  }
});

export {
  MAX_SYSTEM_PROMPT_CHARS,
  assistantConfigResource
};
