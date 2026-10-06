import { defineFeature } from "@jskit-ai/kernel/server/features";
import { actionIds } from "./actionIds.js";
import { createAssistantActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { registerConversationSubscriptions } from "./registerConversationSubscriptions.js";

const subscriptionLifecycle = new WeakMap();

const AssistantFeature = defineFeature({
  id: "assistant.runtime",
  domain: "assistant",
  requires: {
    config: "runtime.config",
    env: "runtime.env",
    http: "runtime.http"
  },
  optional: {
    conversationRuntime: "assistant.conversations",
    conversationAccess: "assistant.conversation.access",
    assistantConfigService: "assistant.settings",
    database: "runtime.database",
    realtime: "runtime.realtime",
    events: "runtime.events",
    aiConnections: "integrations.ai",
    attachments: "assistant.attachments",
    consoleRuntime: "console.core",
    workspaces: "workspaces.core"
  },
  provides: {
    assistant: "assistant.runtime"
  },
  async setup(dependencies, { actionCatalogue }) {
    const { conversationRuntime, conversationAccess, assistantConfigService } = dependencies;
    if (conversationAccess != null) {
      if (!conversationRuntime || typeof conversationAccess.router?.register !== "function" ||
          typeof conversationAccess.wrapAction !== "function") {
        throw new TypeError("assistant.conversation.access requires assistant.conversations, router.register() and wrapAction().");
      }
      if (!["authenticated", "host"].includes(conversationAccess.requestPolicy) ||
          typeof conversationAccess.subscribeActionId !== "string" || !conversationAccess.subscribeActionId.trim() ||
          (conversationAccess.requestPolicy === "host" && conversationAccess.subscribeActionId === actionIds.conversationSubscribe)) {
        throw new TypeError("assistant.conversation.access requires a fixed subscribeActionId and authenticated or host requestPolicy.");
      }
    }
    let assistant;
    if (conversationRuntime) {
      if (typeof conversationRuntime.open !== "function") {
        throw new TypeError("assistant.conversations requires createConversationRuntime().");
      }
      assistant = Object.freeze({ conversationRuntime,
        services: Object.freeze({ conversations: conversationRuntime, config: assistantConfigService || null }) });
    } else {
      if (!dependencies.database?.knex) {
        throw new Error("AssistantFeature requires assistant.conversations, or runtime.database for database integration.");
      }
      const { createAssistantRuntime } = await import("./createAssistantRuntime.js");
      const { createRepository: createAssistantConfigRepository } = await import("./repositories/assistantConfigRepository.js");
      const { createRepository: createConversationsRepository } = await import("./repositories/conversationsRepository.js");
      const { createRepository: createMessagesRepository } = await import("./repositories/messagesRepository.js");
      const { createRepository: createTurnRequestsRepository } = await import("./repositories/turnRequestsRepository.js");
      assistant = createAssistantRuntime({
        ...dependencies,
        actionCatalogue,
        repositories: {
          config: createAssistantConfigRepository(dependencies.database.knex),
          conversations: createConversationsRepository(dependencies.database.knex),
          messages: createMessagesRepository(dependencies.database.knex),
          turnRequests: createTurnRequestsRepository(dependencies.database.knex)
        }
      });
    }
    registerRoutes(dependencies.http.router, {
      config: dependencies.config,
      conversationRuntime,
      conversationAccess,
      conversationDataSchema: conversationRuntime?.conversationDataSchema ?? null,
      conversationConfigurationSchema: conversationRuntime?.conversationConfigurationSchema ?? null,
      conversationSelectionSchema: conversationRuntime?.conversationSelectionSchema ?? null,
      conversationReplacementSchema: conversationRuntime?.conversationReplacementSchema ?? null,
      assistantConfigService,
      workspaceScopeSupport: dependencies.workspaces?.scope || null
    });
    subscriptionLifecycle.set(assistant, { actions: actionCatalogue });
    return { assistant };
  },
  actions({ assistant, conversationAccess, config, workspaces }) {
    return createAssistantActions({
      assistantConfigService: assistant.services.config,
      chatService: assistant.services.chat,
      conversationRuntime: assistant.conversationRuntime,
      conversationAccess,
      conversationDataSchema: assistant.conversationRuntime?.conversationDataSchema ?? null,
      conversationConfigurationSchema: assistant.conversationRuntime?.conversationConfigurationSchema ?? null,
      conversationSelectionSchema: assistant.conversationRuntime?.conversationSelectionSchema ?? null,
      conversationReplacementSchema: assistant.conversationRuntime?.conversationReplacementSchema ?? null,
      workspaceScopeSupport: workspaces?.scope || null,
      config
    });
  },
  boot({ conversationRuntime, conversationAccess, realtime, events, config, workspaces }, { outputs }) {
    if (!conversationRuntime || !realtime) return;
    const state = subscriptionLifecycle.get(outputs.assistant);
    state.release = registerConversationSubscriptions({
      realtime, events, actions: state.actions, config, workspaceScopeSupport: workspaces?.scope || null,
      ...(conversationAccess ? {
        subscribeActionId: conversationAccess.subscribeActionId,
        requestPolicy: conversationAccess.requestPolicy
      } : {})
    });
  },
  async shutdown(_dependencies, { outputs }) {
    subscriptionLifecycle.get(outputs.assistant)?.release?.();
    subscriptionLifecycle.delete(outputs.assistant);
    await outputs.assistant.services.chat?.close();
  }
});

export { AssistantFeature };
