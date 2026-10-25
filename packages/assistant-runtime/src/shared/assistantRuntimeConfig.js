const assistantRuntimeConfig = Object.freeze({
  configTable: "assistant_config",
  conversationsTable: "assistant_conversations",
  messagesTable: "assistant_messages",
  turnRequestsTable: "assistant_turn_requests"
});

const DEFAULT_CONVERSATION_TITLE = "New conversation";

export { DEFAULT_CONVERSATION_TITLE, assistantRuntimeConfig };
