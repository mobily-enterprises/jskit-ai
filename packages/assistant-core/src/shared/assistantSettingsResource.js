import { createSchema } from "json-rest-schema";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const MAX_SYSTEM_PROMPT_CHARS = 12_000;

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
    schema: createSchema({
      systemPrompt: {
        type: "string",
        required: true,
        maxLength: MAX_SYSTEM_PROMPT_CHARS
      }
    })
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

const assistantConfigResource = defineCrudResource({
  namespace: "assistantConfig",
  crudOperations: ["view", "patch"],
  crud: {
    output: assistantConfigRecordSchema,
    patchBody: assistantConfigPatchSchema
  }
});

export {
  MAX_SYSTEM_PROMPT_CHARS,
  assistantConfigResource
};
