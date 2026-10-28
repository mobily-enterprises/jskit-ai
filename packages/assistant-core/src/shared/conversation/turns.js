/** A turn's messages in canonical order: system, user, activity, final assistant. */
export function conversationTurnMessages(turn) {
  return turn.messages || [
    turn.system,
    turn.user,
    ...(turn.thinking || []),
    ...(turn.commentary || []),
    turn.assistant
  ].filter(Boolean);
}

// A finished turn without text shows its status. The English stays in text; textCode
// lets a client show it in the user's language.
const STATUS_TEXTS = Object.freeze({
  interrupted: Object.freeze({ text: "Stopped.", messageCode: "assistant.turn.stopped" }),
  failed: Object.freeze({ text: "Assistant stopped with an error.", messageCode: "assistant.turn.failed" })
});

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
      if (!message.text && Object.hasOwn(STATUS_TEXTS, message.status)) {
        message.text = STATUS_TEXTS[message.status].text;
        message.textCode = STATUS_TEXTS[message.status].messageCode;
      }
      current.assistant = message;
    }
    if (message.role !== "assistant" || message.text) current.messages.push(message);
  }
  return turns;
}
