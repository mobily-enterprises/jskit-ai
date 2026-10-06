import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";

const assistantSurfaceRouteParamsSchema = createSchema({
  surfaceId: {
    type: "string",
    required: true,
    lowercase: true,
    minLength: 1,
    maxLength: 64
  }
});

const assistantTargetSurfaceInputSchema = createSchema({
  targetSurfaceId: {
    type: "string",
    required: true,
    lowercase: true,
    minLength: 1,
    maxLength: 64
  },
  workspaceSlug: {
    type: "string",
    required: false,
    lowercase: true,
    minLength: 1,
    maxLength: 160
  }
});

const assistantSurfaceRouteParamsValidator = deepFreeze({
  schema: assistantSurfaceRouteParamsSchema,
  mode: "patch"
});

const assistantTargetSurfaceInputValidator = deepFreeze({
  schema: assistantTargetSurfaceInputSchema,
  mode: "patch"
});

const assistantConversationIdInputValidator = deepFreeze({
  schema: createSchema({
    conversationId: { type: "string", required: true, minLength: 1 }
  }),
  mode: "patch"
});

const assistantConversationMessageIdInputValidator = deepFreeze({
  schema: createSchema({
    messageId: { type: "string", required: true, minLength: 1, maxLength: 128 }
  }),
  mode: "patch"
});

const assistantConversationReadQueryValidator = deepFreeze({
  schema: createSchema({
    beforeTurnId: { type: "string", noTrim: false, required: false },
    limit: { type: "string", noTrim: false, required: false }
  }),
  mode: "patch"
});

const assistantConversationSendBodyValidator = deepFreeze({
  schema: createSchema({
    messageId: { type: "string", required: true, minLength: 1, maxLength: 128 },
    text: { type: "string", required: true },
    attachmentIds: {
      type: "array", required: false, maxItems: 10,
      items: { type: "string", minLength: 1, maxLength: 256 }
    },
    steer: { type: "boolean", required: false }
  }),
  mode: "patch"
});

function conversationSendBodyValidator(conversationDataSchema = null) {
  if (!conversationDataSchema) return assistantConversationSendBodyValidator;
  return composeSchemaDefinitions([assistantConversationSendBodyValidator, {
    schema: createSchema({ data: { type: "object", required: false, schema: conversationDataSchema } }),
    mode: "patch"
  }], { mode: "patch", context: "assistant-runtime declared conversation data" });
}

function conversationConfigureBodyValidator(configurationSchema) {
  return deepFreeze({
    schema: createSchema({ configuration: { type: "object", required: true, schema: configurationSchema } }),
    mode: "replace"
  });
}

function conversationSelectBodyValidator(selectionSchema) {
  return deepFreeze({
    schema: createSchema({ selection: { type: "object", required: true, schema: selectionSchema } }),
    mode: "replace"
  });
}

function conversationReplaceBodyValidator(replacementSchema) {
  return deepFreeze({
    schema: createSchema({ replacement: { type: "object", required: true, schema: replacementSchema } }),
    mode: "replace"
  });
}

const assistantConversationGoalBodyValidator = deepFreeze({
  schema: createSchema({
    action: { type: "string", required: true, enum: ["set", "resume", "pause", "cancel"] },
    expectedSegmentId: { type: "string", required: true, nullable: true, minLength: 1, maxLength: 128 },
    expectedGoalId: { type: "string", required: false, nullable: true, minLength: 1, maxLength: 256 },
    messageId: { type: "string", required: false, minLength: 1, maxLength: 128 },
    objective: { type: "string", required: false, minLength: 1, maxLength: 4000 },
    tokenBudget: { type: "integer", required: false, nullable: true, min: 1, max: Number.MAX_SAFE_INTEGER },
    attachmentIds: {
      type: "array", required: false, maxItems: 10,
      items: { type: "string", minLength: 1, maxLength: 256 }
    }
  }),
  mode: "replace"
});

export {
  assistantConversationIdInputValidator,
  assistantConversationMessageIdInputValidator,
  assistantConversationReadQueryValidator,
  assistantConversationSendBodyValidator,
  conversationSendBodyValidator,
  conversationConfigureBodyValidator,
  conversationSelectBodyValidator,
  conversationReplaceBodyValidator,
  assistantConversationGoalBodyValidator,
  assistantSurfaceRouteParamsValidator,
  assistantTargetSurfaceInputValidator
};
