import {
  EMPTY_INPUT_VALIDATOR
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspaceSlugParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import {
  assistantConfigResource,
  assistantResource
} from "@jskit-ai/assistant-core/shared";
import { assistantRuntimeConfig } from "../shared/assistantRuntimeConfig.js";
import { actionIds } from "./actionIds.js";

const runtimeSurfaces = Object.freeze([assistantRuntimeConfig.runtimeSurfaceId]);
const settingsSurfaces = Object.freeze([assistantRuntimeConfig.settingsSurfaceId]);

const runtimeQueryInputValidator = assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace
  ? [workspaceSlugParamsValidator, { query: assistantResource.operations.conversationsList.queryValidator }]
  : { query: assistantResource.operations.conversationsList.queryValidator };

const runtimeMessagesInputValidator = assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace
  ? [
      workspaceSlugParamsValidator,
      assistantResource.operations.conversationMessagesList.paramsValidator,
      {
        query: assistantResource.operations.conversationMessagesList.queryValidator
      }
    ]
  : [
      assistantResource.operations.conversationMessagesList.paramsValidator,
      {
        query: assistantResource.operations.conversationMessagesList.queryValidator
      }
    ];

const runtimeChatInputValidator = assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace
  ? [workspaceSlugParamsValidator, assistantResource.operations.chatStream.bodyValidator]
  : assistantResource.operations.chatStream.bodyValidator;

const settingsReadInputValidator = assistantRuntimeConfig.settingsSurfaceRequiresWorkspace
  ? workspaceSlugParamsValidator
  : EMPTY_INPUT_VALIDATOR;

const settingsUpdateInputValidator = assistantRuntimeConfig.settingsSurfaceRequiresWorkspace
  ? [
      workspaceSlugParamsValidator,
      {
        patch: assistantConfigResource.operations.patch.bodyValidator
      }
    ]
  : {
      patch: assistantConfigResource.operations.patch.bodyValidator
    };

const settingsReadPermission = assistantRuntimeConfig.settingsSurfaceRequiresWorkspace
  ? {
      require: "any",
      permissions: ["workspace.settings.view", "workspace.settings.update"]
    }
  : {
      require: "authenticated"
    };

const settingsUpdatePermission = assistantRuntimeConfig.settingsSurfaceRequiresWorkspace
  ? {
      require: "all",
      permissions: ["workspace.settings.update"]
    }
  : {
      require: "authenticated"
    };

const assistantActions = Object.freeze([
  {
    id: actionIds.chatStream,
    version: 1,
    kind: "stream",
    channels: ["api", "internal"],
    surfaces: runtimeSurfaces,
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
    surfaces: runtimeSurfaces,
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
    surfaces: runtimeSurfaces,
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
    surfaces: settingsSurfaces,
    permission: settingsReadPermission,
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
    surfaces: settingsSurfaces,
    permission: settingsUpdatePermission,
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
