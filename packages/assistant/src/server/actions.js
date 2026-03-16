import { workspaceSlugParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { assistantResource } from "../shared/assistantResource.js";
import { actionIds } from "./actionIds.js";

const assistantActions = Object.freeze([
  {
    id: actionIds.chatStream,
    version: 1,
    kind: "stream",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: [workspaceSlugParamsValidator, assistantResource.operations.chatStream.bodyValidator],
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
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: [workspaceSlugParamsValidator, assistantResource.operations.conversationsList.queryValidator],
    outputValidator: assistantResource.operations.conversationsList.outputValidator,
    idempotency: "none",
    audit: {
      actionName: actionIds.conversationsList
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.chatService.listConversations(input, {
        context
      });
    }
  },
  {
    id: actionIds.conversationMessagesList,
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: [
      workspaceSlugParamsValidator,
      assistantResource.operations.conversationMessagesList.paramsValidator,
      assistantResource.operations.conversationMessagesList.queryValidator
    ],
    outputValidator: assistantResource.operations.conversationMessagesList.outputValidator,
    idempotency: "none",
    audit: {
      actionName: actionIds.conversationMessagesList
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.chatService.getConversationMessages(input.conversationId, input, {
        context
      });
    }
  }
]);

export { assistantActions };
