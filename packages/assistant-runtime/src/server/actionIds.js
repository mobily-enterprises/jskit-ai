const actionIds = Object.freeze({
  chatStream: "assistant.chat.stream",
  conversationRead: "assistant.conversation.read",
  conversationSend: "assistant.conversation.send",
  conversationCancel: "assistant.conversation.cancel",
  conversationSubscribe: "assistant.conversation.subscribe",
  conversationInspectDelivery: "assistant.conversation.delivery.inspect",
  conversationGoalRead: "assistant.conversation.goal.read",
  conversationGoalUpdate: "assistant.conversation.goal.update",
  conversationConfigure: "assistant.conversation.configure",
  conversationSelect: "assistant.conversation.select",
  conversationReplace: "assistant.conversation.replace",
  conversationsList: "assistant.conversations.list",
  conversationMessagesList: "assistant.conversation.messages.list",
  settingsRead: "assistant.settings.read",
  settingsUpdate: "assistant.settings.update"
});

export { actionIds };
