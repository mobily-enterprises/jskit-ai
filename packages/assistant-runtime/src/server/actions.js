import { createSchema } from "json-rest-schema";
import {
  composeSchemaDefinitions
} from "@jskit-ai/kernel/shared/validators";
import {
  deepFreeze
} from "@jskit-ai/kernel/shared/support/deepFreeze";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import {
  assistantConfigResource,
  assistantResource
} from "@jskit-ai/assistant-core/shared";
import { actionIds } from "./actionIds.js";
import { assistantTargetSurfaceInputValidator } from "./inputSchemas.js";

const runtimeConversationsListQueryInputValidator = deepFreeze({
  schema: createSchema({
    query: {
      type: "object",
      required: false,
      schema: assistantResource.operations.conversationsList.query.schema
    }
  }),
  mode: "patch"
});

const runtimeConversationsListInputValidator = composeSchemaDefinitions(
  [assistantTargetSurfaceInputValidator, runtimeConversationsListQueryInputValidator],
  {
    mode: "patch",
    context: "assistant-runtime conversations list action input"
  }
);

const runtimeConversationMessagesListQueryInputValidator = deepFreeze({
  schema: createSchema({
    query: {
      type: "object",
      required: false,
      schema: assistantResource.operations.conversationMessagesList.query.schema
    }
  }),
  mode: "patch"
});

const runtimeConversationMessagesListInputValidator = composeSchemaDefinitions(
  [
    assistantTargetSurfaceInputValidator,
    assistantResource.operations.conversationMessagesList.params,
    runtimeConversationMessagesListQueryInputValidator
  ],
  {
    mode: "patch",
    context: "assistant-runtime conversation messages action input"
  }
);

const runtimeChatStreamInputValidator = composeSchemaDefinitions(
  [
    assistantTargetSurfaceInputValidator,
    assistantResource.operations.chatStream.body
  ],
  {
    mode: "patch",
    context: "assistant-runtime chat stream action input"
  }
);

const settingsReadInputValidator = assistantTargetSurfaceInputValidator;

const settingsUpdatePatchInputValidator = deepFreeze({
  schema: createSchema({
    patch: {
      type: "object",
      required: true,
      schema: assistantConfigResource.operations.patch.body.schema
    }
  }),
  mode: "patch"
});

const settingsUpdateInputValidator = composeSchemaDefinitions(
  [assistantTargetSurfaceInputValidator, settingsUpdatePatchInputValidator],
  {
    mode: "patch",
    context: "assistant-runtime settings update action input"
  }
);

const assistantActions = Object.freeze([
  {
    id: actionIds.chatStream,
    version: 1,
    kind: "stream",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: runtimeChatStreamInputValidator,
    idempotency: "optional",
    audit: {
      actionName: actionIds.chatStream
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.chatService.streamChat(input, {
        context,
        streamWriter: deps.streamWriter,
        abortSignal: deps.abortSignal
      });
    }
  },
  {
    id: actionIds.conversationsList,
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: runtimeConversationsListInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: actionIds.conversationsList
    },
    observability: {},
    async execute(input, context, deps) {
      return returnJsonApiData(await deps.chatService.listConversations(input.query, {
        context,
        input
      }));
    }
  },
  {
    id: actionIds.conversationMessagesList,
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: runtimeConversationMessagesListInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: actionIds.conversationMessagesList
    },
    observability: {},
    async execute(input, context, deps) {
      return returnJsonApiData(await deps.chatService.getConversationMessages(input.conversationId, input.query, {
        context,
        input
      }));
    }
  },
  {
    id: actionIds.settingsRead,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: settingsReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: actionIds.settingsRead
    },
    observability: {},
    async execute(input, context, deps) {
      return returnJsonApiData(await deps.assistantConfigService.getSettings(input, {
        context
      }));
    }
  },
  {
    id: actionIds.settingsUpdate,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: settingsUpdateInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: actionIds.settingsUpdate
    },
    observability: {},
    async execute(input, context, deps) {
      return returnJsonApiData(await deps.assistantConfigService.updateSettings(input, input.patch, {
        context
      }));
    }
  }
]);

export { assistantActions };
