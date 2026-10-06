import { createSchema } from "json-rest-schema";
import {
  composeSchemaDefinitions
} from "@jskit-ai/kernel/shared/validators";
import {
  deepFreeze
} from "@jskit-ai/kernel/shared/support/deepFreeze";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import {
  assistantResource
} from "@jskit-ai/assistant-core/shared";
import { actionIds } from "./actionIds.js";
import { createAssistantSettingsActions } from "./createAssistantSettingsActions.js";
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

function configuredAssistantSurfaces(config = {}) {
  return Object.keys(resolveAssistantSurfacesConfig(config))
    .map((surfaceId) => resolveAssistantSurfaceConfig(config, surfaceId))
    .filter(Boolean);
}

const conversationInputValidator = composeSchemaDefinitions(
  [assistantTargetSurfaceInputValidator, assistantConversationIdInputValidator],
  { mode: "patch", context: "assistant-runtime conversation action input" }
);

const conversationInspectInputValidator = composeSchemaDefinitions(
  [conversationInputValidator, assistantConversationMessageIdInputValidator],
  { mode: "patch", context: "assistant-runtime conversation delivery inspection input" }
);

const conversationReadInputValidator = composeSchemaDefinitions(
  [conversationInputValidator, assistantConversationReadQueryValidator],
  { mode: "patch", context: "assistant-runtime conversation read action input" }
);

function createConversationActions({ conversationRuntime, conversationDataSchema, conversationConfigurationSchema,
  conversationSelectionSchema, conversationReplacementSchema, config, runtimeSurfaces, workspaceScopeSupport }) {
  const conversationSendInputValidator = composeSchemaDefinitions(
    [conversationInputValidator, conversationSendBodyValidator(conversationDataSchema)],
    { mode: "patch", context: "assistant-runtime conversation send action input" }
  );
  async function openConversation(input, context) {
    const assistantSurface = resolveAssistantSurfaceConfig(config, input.targetSurfaceId);
    if (!assistantSurface) throw new AppError(404, "Assistant not found.");
    let conversationContext = context;
    if (assistantSurface.runtimeSurfaceRequiresWorkspace) {
      if (typeof workspaceScopeSupport?.resolveWorkspace !== "function") {
        throw new Error("Assistant conversation actions require workspace server scope support.");
      }
      const workspace = workspaceScopeSupport.resolveWorkspace(context, { workspaceSlug: input.workspaceSlug });
      if (!workspace?.id) throw new AppError(409, "Workspace selection required.");
      conversationContext = { ...context, workspace };
    }
    return conversationRuntime.open({ id: input.conversationId, context: conversationContext });
  }

  return [
    {
      id: actionIds.conversationRead,
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationReadInputValidator,
      output: null,
      idempotency: "none",
      audit: { actionName: actionIds.conversationRead },
      observability: {},
      async execute(input, context) {
        const conversation = await openConversation(input, context);
        const options = {};
        for (const key of ["beforeTurnId", "limit"]) {
          if (Object.hasOwn(input, key)) options[key] = input[key];
        }
        return Object.keys(options).length ? conversation.read(options) : conversation.read();
      }
    },
    {
      id: actionIds.conversationSend,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationSendInputValidator,
      output: null,
      idempotency: "none",
      audit: { actionName: actionIds.conversationSend },
      observability: {},
      async execute(input, context) {
        const conversation = await openConversation(input, context);
        return conversation.send({
          messageId: input.messageId,
          text: input.text,
          ...(conversationDataSchema && Object.hasOwn(input, "data") ? { data: input.data } : {}),
          ...(Object.hasOwn(input, "attachmentIds") ? { attachmentIds: input.attachmentIds } : {}),
          ...(Object.hasOwn(input, "steer") ? { steer: input.steer } : {})
        });
      }
    },
    {
      id: actionIds.conversationCancel,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationInputValidator,
      output: null,
      idempotency: "none",
      audit: { actionName: actionIds.conversationCancel },
      observability: {},
      async execute(input, context) {
        const conversation = await openConversation(input, context);
        return conversation.cancel();
      }
    },
    {
      id: actionIds.conversationSubscribe,
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationInputValidator,
      output: null,
      idempotency: "none",
      audit: { actionName: actionIds.conversationSubscribe },
      observability: {},
      async execute(input, context, deps) {
        if (typeof deps?.onEvent !== "function" || typeof deps?.onRelease !== "function") {
          throw new TypeError("Conversation subscriptions require their server-owned event and cleanup callbacks.");
        }
        const conversation = await openConversation(input, context);
        const release = await conversation.subscribe(deps.onEvent);
        try {
          deps.onRelease(release);
          return await conversation.read();
        } catch (error) {
          release();
          throw error;
        }
      }
    },
    {
      id: actionIds.conversationInspectDelivery,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationInspectInputValidator,
      output: null,
      idempotency: "none",
      audit: { actionName: actionIds.conversationInspectDelivery },
      observability: {},
      async execute(input, context) {
        const conversation = await openConversation(input, context);
        return conversation.inspectDelivery({ messageId: input.messageId });
      }
    },
    {
      id: actionIds.conversationGoalRead,
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: runtimeSurfaces,
      permission: { require: "authenticated" },
      input: conversationInputValidator,
      output: null,
      idempotency: "none",
      audit: { actionName: actionIds.conversationGoalRead },
      observability: {},
      async execute(input, context) {
        return (await openConversation(input, context)).readGoal();
      }
    },
    {
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
      idempotency: "none",
      audit: { actionName: actionIds.conversationGoalUpdate },
      observability: {},
      async execute(input, context) {
        const conversation = await openConversation(input, context);
        const goal = { action: input.action, expectedSegmentId: input.expectedSegmentId };
        for (const key of ["expectedGoalId", "messageId", "objective", "tokenBudget", "attachmentIds"]) {
          if (Object.hasOwn(input, key)) goal[key] = input[key];
        }
        return conversation.updateGoal(goal);
      }
    },
    ...(conversationConfigurationSchema ? [{
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
      idempotency: "none",
      audit: { actionName: actionIds.conversationConfigure },
      observability: {},
      async execute(input, context) {
        return (await openConversation(input, context)).configure(input.configuration);
      }
    }] : []),
    ...(conversationSelectionSchema ? [{
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
      idempotency: "none",
      audit: { actionName: actionIds.conversationSelect },
      observability: {},
      async execute(input, context) {
        return (await openConversation(input, context)).select(input.selection);
      }
    }] : []),
    ...(conversationReplacementSchema ? [{
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
      idempotency: "none",
      audit: { actionName: actionIds.conversationReplace },
      observability: {},
      async execute(input, context) {
        return (await openConversation(input, context)).replace(input.replacement);
      }
    }] : [])
  ];
}

function createAssistantActions({
  assistantConfigService,
  chatService,
  conversationRuntime = null,
  conversationAccess = null,
  conversationDataSchema = null,
  conversationConfigurationSchema = null,
  conversationSelectionSchema = null,
  conversationReplacementSchema = null,
  workspaceScopeSupport = null,
  config = {}
} = {}) {
  if (conversationRuntime && typeof conversationRuntime.open !== "function") {
    throw new TypeError("Assistant conversation actions require conversationRuntime.open().");
  }
  if (!conversationRuntime && (!assistantConfigService || !chatService)) {
    throw new TypeError("createAssistantActions requires assistantConfigService and chatService.");
  }
  const configuredSurfaces = configuredAssistantSurfaces(config);
  const runtimeSurfaces = [...new Set(configuredSurfaces.map((entry) => entry.targetSurfaceId))];
  const settingsSurfaces = [...new Set(configuredSurfaces.map((entry) => entry.settingsSurfaceId))];
  if (runtimeSurfaces.length === 0 || settingsSurfaces.length === 0) return [];

  if (conversationRuntime) {
    const conversationActions = createConversationActions({
      conversationRuntime, conversationDataSchema, conversationConfigurationSchema, conversationSelectionSchema, conversationReplacementSchema,
      config, runtimeSurfaces, workspaceScopeSupport
    });
    return Object.freeze([
      ...conversationActions.map((definition) => {
        if (!conversationAccess) return definition;
        const selected = definition.id === actionIds.conversationSubscribe ? {
          ...definition,
          id: conversationAccess.subscribeActionId,
          audit: { ...definition.audit, actionName: conversationAccess.subscribeActionId }
        } : definition;
        return conversationAccess.wrapAction(selected);
      }),
      ...(assistantConfigService ? createAssistantSettingsActions({ assistantConfigService, settingsSurfaces }) : [])
    ]);
  }

  return Object.freeze([
  {
    id: actionIds.chatStream,
    version: 1,
    kind: "stream",
    channels: ["api", "internal"],
    surfaces: runtimeSurfaces,
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
      return chatService.streamChat(input, {
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
    input: runtimeConversationsListInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: actionIds.conversationsList
    },
    observability: {},
    async execute(input, context) {
      return returnJsonApiData(await chatService.listConversations(input.query, {
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
    surfaces: runtimeSurfaces,
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
    async execute(input, context) {
      return returnJsonApiData(await chatService.getConversationMessages(input.conversationId, input.query, {
        context,
        input
      }));
    }
  },
  ...createAssistantSettingsActions({ assistantConfigService, settingsSurfaces })
  ]);
}

export { createAssistantActions };
