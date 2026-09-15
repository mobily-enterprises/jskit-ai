/** Adapt ordered messages to the transcript's turn model without changing their metadata. */
export function conversationTurnsFromMessages(messages = []) {
  const turns = [];
  let current = null;
  for (const [index, source] of messages.entries()) {
    const message = { ...source, messageId: String(source.messageId || source.id || `message-${index}`) };
    if (message.role === "system") {
      turns.push({ turnId: message.messageId, system: message, messages: [message] });
      current = null;
      continue;
    }
    if (message.role === "user" || !current || current.assistant) {
      current = { turnId: message.messageId, messages: [] };
      turns.push(current);
    }
    if (message.role === "user") current.user = message;
    if (message.role === "assistant") {
      current.pending = ["starting", "inProgress"].includes(message.status);
      for (const [progressIndex, progress] of (message.progressUpdates || []).entries()) {
        current.messages.push({ ...progress, role: progress.role || "thinking", messageId: `${message.messageId}:progress:${progress.id || progressIndex}` });
      }
      if (!message.text && ["failed", "interrupted"].includes(message.status)) {
        message.text = message.status === "interrupted" ? "Stopped." : "Assistant stopped with an error.";
      }
      current.assistant = message;
    }
    if (message.role !== "assistant" || message.text) current.messages.push(message);
  }
  return turns;
}
