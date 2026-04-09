import {
  assistantConfigResource,
  assistantResource
} from "@jskit-ai/assistant-core/shared";
import { actionIds } from "./actionIds.js";
import { assistantTargetSurfaceInputValidator } from "./inputValidators.js";

const runtimeQueryInputValidator = [
  assistantTargetSurfaceInputValidator,
  { query: assistantResource.operations.conversationsList.queryValidator }
];

const runtimeMessagesInputValidator = [
  assistantTargetSurfaceInputValidator,
  assistantResource.operations.conversationMessagesList.paramsValidator,
  {
    query: assistantResource.operations.conversationMessagesList.queryValidator
  }
];

const runtimeChatInputValidator = [
  assistantTargetSurfaceInputValidator,
  assistantResource.operations.chatStream.bodyValidator
];

const settingsReadInputValidator = assistantTargetSurfaceInputValidator;

const settingsUpdateInputValidator = [
  assistantTargetSurfaceInputValidator,
  {
    patch: assistantConfigResource.operations.patch.bodyValidator
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
    inputValidator: runtimeChatInputValidator,
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
    inputValidator: runtimeQueryInputValidator,
    outputValidator: assistantResource.operations.conversationsList.outputValidator,
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
    inputValidator: runtimeMessagesInputValidator,
    outputValidator: assistantResource.operations.conversationMessagesList.outputValidator,
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
    inputValidator: settingsReadInputValidator,
    outputValidator: assistantConfigResource.operations.view.outputValidator,
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
    inputValidator: settingsUpdateInputValidator,
    outputValidator: assistantConfigResource.operations.patch.outputValidator,
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
