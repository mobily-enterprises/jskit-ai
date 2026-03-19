import { workspaceSlugParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { resolveWorkspace } from "@jskit-ai/users-core/server/support/resolveWorkspace";
import {
  EMPTY_INPUT_VALIDATOR
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { assistantResource } from "../shared/assistantResource.js";
import {
  assistantConsoleSettingsResource,
  assistantWorkspaceSettingsResource
} from "../shared/assistantSettingsResource.js";
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
    inputValidator: [
      workspaceSlugParamsValidator,
      {
        query: assistantResource.operations.conversationsList.queryValidator
      }
    ],
    outputValidator: assistantResource.operations.conversationsList.outputValidator,
    idempotency: "none",
    audit: {
      actionName: actionIds.conversationsList
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.chatService.listConversations(input.query, {
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
      {
        query: assistantResource.operations.conversationMessagesList.queryValidator
      }
    ],
    outputValidator: assistantResource.operations.conversationMessagesList.outputValidator,
    idempotency: "none",
    audit: {
      actionName: actionIds.conversationMessagesList
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.chatService.getConversationMessages(input.conversationId, input.query, {
        context
      });
    }
  },
  {
    id: actionIds.consoleSettingsRead,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "console",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: EMPTY_INPUT_VALIDATOR,
    outputValidator: assistantConsoleSettingsResource.operations.view.outputValidator,
    idempotency: "none",
    audit: {
      actionName: actionIds.consoleSettingsRead
    },
    observability: {},
    async execute(_input, context, deps) {
      return deps.assistantSettingsService.getConsoleSettings({
        context
      });
    }
  },
  {
    id: actionIds.consoleSettingsUpdate,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "console",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: {
      payload: assistantConsoleSettingsResource.operations.patch.bodyValidator
    },
    outputValidator: assistantConsoleSettingsResource.operations.patch.outputValidator,
    idempotency: "optional",
    audit: {
      actionName: actionIds.consoleSettingsUpdate
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.assistantSettingsService.updateConsoleSettings(input.payload, {
        context
      });
    }
  },
  {
    id: actionIds.workspaceSettingsRead,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    permission: {
      require: "any",
      permissions: ["workspace.settings.view", "workspace.settings.update"]
    },
    inputValidator: workspaceSlugParamsValidator,
    outputValidator: assistantWorkspaceSettingsResource.operations.view.outputValidator,
    idempotency: "none",
    audit: {
      actionName: actionIds.workspaceSettingsRead
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.assistantSettingsService.getWorkspaceSettings(resolveWorkspace(context, input), {
        context
      });
    }
  },
  {
    id: actionIds.workspaceSettingsUpdate,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    permission: {
      require: "all",
      permissions: ["workspace.settings.update"]
    },
    inputValidator: [
      workspaceSlugParamsValidator,
      {
        patch: assistantWorkspaceSettingsResource.operations.patch.bodyValidator
      }
    ],
    outputValidator: assistantWorkspaceSettingsResource.operations.patch.outputValidator,
    idempotency: "optional",
    audit: {
      actionName: actionIds.workspaceSettingsUpdate
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.assistantSettingsService.updateWorkspaceSettings(resolveWorkspace(context, input), input.patch, {
        context
      });
    }
  }
]);

export { assistantActions };
