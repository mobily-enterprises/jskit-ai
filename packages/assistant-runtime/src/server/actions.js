import { createSchema } from "json-rest-schema";
import {
  composeSchemaDefinitions
} from "@jskit-ai/kernel/shared/validators";
import {
  deepFreeze
} from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  assistantConfigResource,
  assistantResource
} from "@jskit-ai/assistant-core/shared";
import { actionIds } from "./actionIds.js";
import { assistantTargetSurfaceInput } from "./inputSchemas.js";

const runtimeConversationsListQueryInput = deepFreeze({
  schema: createSchema({
    query: {
      type: "object",
      required: false,
      schema: assistantResource.operations.conversationsList.query.schema
    }
  }),
  mode: "patch"
});

const runtimeConversationsListInput = composeSchemaDefinitions(
  [assistantTargetSurfaceInput, runtimeConversationsListQueryInput],
  {
    mode: "patch",
    context: "assistant-runtime conversations list action input"
  }
);

const runtimeConversationMessagesListQueryInput = deepFreeze({
  schema: createSchema({
    query: {
      type: "object",
      required: false,
      schema: assistantResource.operations.conversationMessagesList.query.schema
    }
  }),
  mode: "patch"
});

const runtimeConversationMessagesListInput = composeSchemaDefinitions(
  [
    assistantTargetSurfaceInput,
    assistantResource.operations.conversationMessagesList.params,
    runtimeConversationMessagesListQueryInput
  ],
  {
    mode: "patch",
    context: "assistant-runtime conversation messages action input"
  }
);

const runtimeChatStreamInput = composeSchemaDefinitions(
  [
    assistantTargetSurfaceInput,
    assistantResource.operations.chatStream.body
  ],
  {
    mode: "patch",
    context: "assistant-runtime chat stream action input"
  }
);

const settingsReadInput = assistantTargetSurfaceInput;

const settingsUpdatePatchInput = deepFreeze({
  schema: createSchema({
    patch: {
      type: "object",
      required: true,
      schema: assistantConfigResource.operations.patch.body.schema
    }
  }),
  mode: "patch"
});

const settingsUpdateInput = composeSchemaDefinitions(
  [assistantTargetSurfaceInput, settingsUpdatePatchInput],
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
    input: runtimeChatStreamInput,
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
    input: runtimeConversationsListInput,
    output: assistantResource.operations.conversationsList.output,
    idempotency: "none",
    audit: {
      actionName: actionIds.conversationsList
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.chatService.listConversations(input.query, {
        context,
        input
      });
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
    input: runtimeConversationMessagesListInput,
    output: assistantResource.operations.conversationMessagesList.output,
    idempotency: "none",
    audit: {
      actionName: actionIds.conversationMessagesList
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.chatService.getConversationMessages(input.conversationId, input.query, {
        context,
        input
      });
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
    input: settingsReadInput,
    output: assistantConfigResource.operations.view.output,
    idempotency: "none",
    audit: {
      actionName: actionIds.settingsRead
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.assistantConfigService.getSettings(input, {
        context
      });
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
    input: settingsUpdateInput,
    output: assistantConfigResource.operations.patch.output,
    idempotency: "optional",
    audit: {
      actionName: actionIds.settingsUpdate
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.assistantConfigService.updateSettings(input, input.patch, {
        context
      });
    }
  }
]);

export { assistantActions };
