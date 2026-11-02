import { createSchema } from "json-rest-schema";
import {
  composeSchemaDefinitions
} from "@jskit-ai/kernel/shared/validators";
import {
  deepFreeze
} from "@jskit-ai/kernel/shared/support/deepFreeze";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import {
  assistantResource
} from "@jskit-ai/assistant-core/shared";
import { actionIds } from "./actionIds.js";
import { createAssistantSettingsActions } from "./createAssistantSettingsActions.js";
import { createConversationOperations } from "./conversationOperations.js";
import {
  assistantConversationIdInputValidator,
  assistantConversationGoalBodyValidator,
  assistantConversationMessageIdInputValidator,
  assistantConversationReadQueryValidator,
  conversationConfigureBodyValidator,
  conversationSelectBodyValidator,
  conversationReplaceBodyValidator,
  conversationSendBodyValidator,
  assistantTargetSurfaceInputValidator
} from "./inputSchemas.js";
import {
  resolveAssistantSurfaceConfig,
  resolveAssistantSurfacesConfig
} from "../shared/assistantSurfaces.js";

/** @typedef {import("./types.js").AssistantConfigService} AssistantConfigService */
/** @typedef {import("./types.js").ChatService} ChatService */
/** @typedef {import("./types.js").ConversationAccess} ConversationAccess */
/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("./types.js").WorkspaceScopeSupport} WorkspaceScopeSupport */
/** @typedef {ReturnType<typeof createConversationOperations>} ConversationOperations */

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
    mode: "create",
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
    mode: "create",
    context: "assistant-runtime conversation messages action input"
  }
);

const runtimeChatStreamInputValidator = composeSchemaDefinitions(
  [
    assistantTargetSurfaceInputValidator,
    assistantResource.operations.chatStream.body
  ],
  {
    mode: "create",
    context: "assistant-runtime chat stream action input"
  }
);

function configuredAssistantSurfaces(config = {}) {
  return Object.keys(resolveAssistantSurfacesConfig(config))
    .map((surfaceId) => resolveAssistantSurfaceConfig(config, surfaceId))
    .filter(Boolean);
}

const conversationInputValidator = composeSchemaDefinitions(
  [assistantTargetSurfaceInputValidator, assistantConversationIdInputValidator],
  { mode: "create", context: "assistant-runtime conversation action input" }
);

const conversationDeliveryInputValidator = composeSchemaDefinitions(
  [conversationInputValidator, assistantConversationMessageIdInputValidator],
  { mode: "create", context: "assistant-runtime conversation delivery inspection input" }
);

const conversationReadInputValidator = composeSchemaDefinitions(
  [conversationInputValidator, assistantConversationReadQueryValidator],
  { mode: "create", context: "assistant-runtime conversation read action input" }
);

/**
 * The JSON:API documents the transcript actions answer with.
 * @param {{ chatService: ChatService }} dependencies
 */
function createTranscriptDocuments({ chatService }) {
  async function listConversations(input, context) {
    return returnJsonApiData(await chatService.listConversations(input.query, {
      context,
      input
    }));
  }

  async function listConversationMessages(input, context) {
    return returnJsonApiData(await chatService.getConversationMessages(input.conversationId, input.query, {
      context,
      input
    }));
  }

  return Object.freeze({
    listConversations,
    listConversationMessages
  });
}

/**
 * @param {object} dependencies
 * @param {ConversationOperations} dependencies.conversationOperations
 * @param {object | null} dependencies.conversationDataSchema
 * @param {object | null} dependencies.conversationConfigurationSchema
 * @param {object | null} dependencies.conversationSelectionSchema
 * @param {object | null} dependencies.conversationReplacementSchema
 * @param {string[]} dependencies.runtimeSurfaces
 */
function createConversationActions({ conversationOperations, conversationDataSchema, conversationConfigurationSchema,
  conversationSelectionSchema, conversationReplacementSchema, runtimeSurfaces }) {
  const conversationSendInputValidator = composeSchemaDefinitions(
    [conversationInputValidator, conversationSendBodyValidator(conversationDataSchema)],
    { mode: "create", context: "assistant-runtime conversation send action input" }
  );

  return Object.freeze([
    Object.freeze({
      id: actionIds.conversationRead,
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationReadInputValidator,
      output: null,
      execute: (input, context) => conversationOperations.read(input, context)
    }),
    Object.freeze({
      id: actionIds.conversationSend,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationSendInputValidator,
      output: null,
      execute: (input, context) => conversationOperations.send(input, context)
    }),
    Object.freeze({
      id: actionIds.conversationCancel,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationInputValidator,
      output: null,
      execute: (input, context) => conversationOperations.cancel(input, context)
    }),
    Object.freeze({
      id: actionIds.conversationSubscribe,
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationInputValidator,
      output: null,
      execute: (input, context, deps) => conversationOperations.subscribe(input, context, deps)
    }),
    Object.freeze({
      id: actionIds.conversationInspectDelivery,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationDeliveryInputValidator,
      output: null,
      execute: (input, context) => conversationOperations.inspectDelivery(input, context)
    }),
    Object.freeze({
      id: actionIds.conversationCancelDelivery,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationDeliveryInputValidator,
      output: null,
      execute: (input, context) => conversationOperations.cancelDelivery(input, context)
    }),
    Object.freeze({
      id: actionIds.conversationGoalRead,
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationInputValidator,
      output: null,
      execute: (input, context) => conversationOperations.readGoal(input, context)
    }),
    Object.freeze({
      id: actionIds.conversationGoalUpdate,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: composeSchemaDefinitions([conversationInputValidator, assistantConversationGoalBodyValidator], {
        mode: "replace", context: "assistant-runtime conversation goal action input"
      }),
      output: null,
      execute: (input, context) => conversationOperations.updateGoal(input, context)
    }),
    ...(conversationConfigurationSchema ? Object.freeze([Object.freeze({
      id: actionIds.conversationConfigure,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: composeSchemaDefinitions([conversationInputValidator, conversationConfigureBodyValidator(conversationConfigurationSchema)], {
        mode: "replace", context: "assistant-runtime declared conversation configuration"
      }),
      output: null,
      execute: (input, context) => conversationOperations.configure(input, context)
    })]) : []),
    ...(conversationSelectionSchema ? Object.freeze([Object.freeze({
      id: actionIds.conversationSelect,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: composeSchemaDefinitions([conversationInputValidator, conversationSelectBodyValidator(conversationSelectionSchema)], {
        mode: "replace", context: "assistant-runtime declared conversation selection"
      }),
      output: null,
      execute: (input, context) => conversationOperations.select(input, context)
    })]) : []),
    ...(conversationReplacementSchema ? Object.freeze([Object.freeze({
      id: actionIds.conversationReplace,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: composeSchemaDefinitions([conversationInputValidator, conversationReplaceBodyValidator(conversationReplacementSchema)], {
        mode: "replace", context: "assistant-runtime declared conversation replacement"
      }),
      output: null,
      execute: (input, context) => conversationOperations.replace(input, context)
    })]) : [])
  ]);
}

/**
 * The assistant's actions: over a conversation runtime the application supplies, its
 * conversation actions (wrapped by the host's access owner when it supplies one) and
 * the settings actions when it supplies a settings service; otherwise the chat stream,
 * transcript and settings actions of the package's own tables. A configuration
 * without a runtime and a settings surface has none.
 * @param {object} dependencies
 * @param {AssistantConfigService | null} dependencies.assistantConfigService
 * @param {ChatService} [dependencies.chatService] The chat service of the package's own tables, without a conversation runtime.
 * @param {ConversationRuntime | null} dependencies.conversationRuntime
 * @param {ConversationAccess | null} dependencies.conversationAccess
 * @param {object | null} dependencies.conversationDataSchema
 * @param {object | null} dependencies.conversationConfigurationSchema
 * @param {object | null} dependencies.conversationSelectionSchema
 * @param {object | null} dependencies.conversationReplacementSchema
 * @param {WorkspaceScopeSupport | null} dependencies.workspaceScopeSupport
 * @param {Record<string, any>} dependencies.config
 */
function createAssistantActions({
  assistantConfigService,
  chatService,
  conversationRuntime,
  conversationAccess,
  conversationDataSchema,
  conversationConfigurationSchema,
  conversationSelectionSchema,
  conversationReplacementSchema,
  workspaceScopeSupport,
  config
}) {
  const configuredSurfaces = configuredAssistantSurfaces(config);
  const runtimeSurfaces = [...new Set(configuredSurfaces.map((entry) => entry.targetSurfaceId))];
  const settingsSurfaces = [...new Set(configuredSurfaces.map((entry) => entry.settingsSurfaceId))];
  if (runtimeSurfaces.length === 0 || settingsSurfaces.length === 0) return [];

  if (conversationRuntime) {
    const conversationOperations = createConversationOperations({
      conversationRuntime,
      config,
      workspaceScopeSupport,
      conversationDataSchema
    });
    const conversationActions = createConversationActions({
      conversationOperations, conversationDataSchema, conversationConfigurationSchema, conversationSelectionSchema, conversationReplacementSchema,
      runtimeSurfaces
    });
    return Object.freeze([
      ...conversationActions.map((definition) => {
        if (!conversationAccess) return definition;
        const selected = definition.id === actionIds.conversationSubscribe ? {
          ...definition,
          id: conversationAccess.subscribeActionId
        } : definition;
        return conversationAccess.wrapAction(selected);
      }),
      ...(assistantConfigService ? createAssistantSettingsActions({ assistantConfigService, settingsSurfaces }) : [])
    ]);
  }

  const transcriptDocuments = createTranscriptDocuments({ chatService });
  return Object.freeze([
    Object.freeze({
      id: actionIds.chatStream,
      version: 1,
      kind: "stream",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: {
        require: "authenticated"
      },
      input: runtimeChatStreamInputValidator,
      execute: (input, context, deps) => chatService.streamChat(input, {
        context,
        streamWriter: deps.streamWriter,
        abortSignal: deps.abortSignal
      })
    }),
    Object.freeze({
      id: actionIds.conversationsList,
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: {
        require: "authenticated"
      },
      input: runtimeConversationsListInputValidator,
      output: null,
      execute: (input, context) => transcriptDocuments.listConversations(input, context)
    }),
    Object.freeze({
      id: actionIds.conversationMessagesList,
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: {
        require: "authenticated"
      },
      input: runtimeConversationMessagesListInputValidator,
      output: null,
      execute: (input, context) => transcriptDocuments.listConversationMessages(input, context)
    }),
    ...createAssistantSettingsActions({ assistantConfigService, settingsSurfaces })
  ]);
}

export { createAssistantActions };
