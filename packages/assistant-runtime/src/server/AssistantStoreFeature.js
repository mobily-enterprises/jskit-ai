import { defineFeature } from "@jskit-ai/kernel/server/features";
import {
  assistantConfigResource,
  assistantConversationsResource,
  assistantMessagesResource,
  assistantTurnRequestsResource
} from "./repositories/assistantResources.js";
import { createRepository as createConfigRepository } from "./repositories/assistantConfigRepository.js";
import { createRepository as createConversationsRepository } from "./repositories/conversationsRepository.js";
import { createRepository as createMessagesRepository } from "./repositories/messagesRepository.js";
import { createRepository as createTurnRequestsRepository } from "./repositories/turnRequestsRepository.js";

/**
 * The repositories of the database-backed assistant over the tables this feature owns.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 */
function createAssistantRepositories({ resources, systemContext }) {
  return Object.freeze({
    config: createConfigRepository({ assistantConfig: resources.assistantConfig, systemContext }),
    conversations: createConversationsRepository({ conversations: resources.assistantConversations, systemContext }),
    messages: createMessagesRepository({
      messages: resources.assistantMessages,
      conversations: resources.assistantConversations,
      systemContext
    }),
    turnRequests: createTurnRequestsRepository({ turnRequests: resources.assistantTurnRequests, systemContext })
  });
}

// The database-backed assistant's tables: settings, conversations, messages and
// request receipts. An application that keeps its assistant in the database
// registers this feature beside AssistantFeature, which takes its repositories;
// an application that supplies assistant.conversations does not.
const AssistantStoreFeature = defineFeature({
  id: "assistant.store",
  domain: "assistant",
  owns: [
    assistantConfigResource,
    assistantConversationsResource,
    assistantMessagesResource,
    assistantTurnRequestsResource
  ],
  systemScope: "the assistant reads and writes its rows by the actor, workspace and surface its own access checks resolved, and keeps global settings that every workspace shares",
  provides: {
    repositories: "assistant.repositories"
  },
  /**
   * @param {object} dependencies
   * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
   * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
   */
  setup({ resources, systemContext }) {
    return { repositories: createAssistantRepositories({ resources, systemContext }) };
  }
});

export { AssistantStoreFeature };
