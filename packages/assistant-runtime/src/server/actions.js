import {
  assistantConfigResource,
  assistantResource
} from "@jskit-ai/assistant-core/shared";
import { actionIds } from "./actionIds.js";
import { assistantTargetSurfaceInput } from "./inputSchemas.js";

const runtimeQueryInputValidator = [
  assistantTargetSurfaceInput,
  { query: assistantResource.operations.conversationsList.query }
];

const runtimeMessagesInputValidator = [
  assistantTargetSurfaceInput,
  assistantResource.operations.conversationMessagesList.params,
  {
    query: assistantResource.operations.conversationMessagesList.query
  }
];

const runtimeChatInputValidator = [
  assistantTargetSurfaceInput,
  assistantResource.operations.chatStream.body
];

const settingsReadInputValidator = assistantTargetSurfaceInput;

const settingsUpdateInputValidator = [
  assistantTargetSurfaceInput,
  {
    patch: assistantConfigResource.operations.patch.body
  }
];

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
    input: runtimeChatInputValidator,
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
    input: runtimeQueryInputValidator,
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
    input: runtimeMessagesInputValidator,
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
    input: settingsReadInputValidator,
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
    input: settingsUpdateInputValidator,
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
