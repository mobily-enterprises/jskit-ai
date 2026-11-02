/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("./types.js").AssistantConfigService} AssistantConfigService */

/**
 * The assistant over a conversation runtime the application supplies: its
 * conversations, and the settings service when the application supplies one.
 * @param {object} dependencies
 * @param {ConversationRuntime} dependencies.conversationRuntime
 * @param {AssistantConfigService | null} dependencies.assistantConfigService
 */
function createHostedAssistant({ conversationRuntime, assistantConfigService }) {
  return Object.freeze({
    conversationRuntime,
    services: Object.freeze({
      conversations: conversationRuntime,
      config: assistantConfigService
    })
  });
}

export { createHostedAssistant };
