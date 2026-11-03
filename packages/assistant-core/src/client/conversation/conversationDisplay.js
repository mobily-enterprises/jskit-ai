// What the transcript shows of a conversation: its saved turns, with the reply still streaming, the delivery's
// unconfirmed messages and the application's unsent previews laid over them.

/**
 * The transcript's props for an adapter's conversation.
 * @param {import("../types.js").AssistantConversationAdapter} adapter
 */
function displayedConversation(adapter) {
  const saved = adapter.conversation;
  if (!adapter.delivery && !saved.previewMessage && !saved.previewMessages?.length && !saved.interimReply) return saved;
  const { previewMessage, previewMessages, interimReply, ...display } = saved;
  let turns = adapter.delivery ? adapter.delivery.turns(saved.turns || []) : saved.turns || [];
  if (interimReply?.text && interimReply.turnId) {
    const assistant = { ...interimReply, messageId: interimReply.id, role: "assistant" };
    turns = turns.map(turn => turn.turnId !== interimReply.turnId ? turn : {
      ...turn, assistant,
      commentary: (turn.commentary || []).filter(message =>
        (message.outputId || message.messageId) !== (interimReply.outputId || interimReply.id)),
      ...(Array.isArray(turn.messages) ? { messages: turn.messages.filter(message =>
        message.role !== "assistant" &&
        (message.outputId || message.messageId) !== (interimReply.outputId || interimReply.id)).concat(assistant) } : {})
    });
  }
  // This list projects existing capture/pending owners; it never queues delivery.
  const previews = Array.isArray(previewMessages) ? previewMessages : previewMessage ? [previewMessage] : [];
  for (const preview of previews) {
    const messageId = String(preview?.messageId || preview?.id || "").trim();
    const localDelivery = messageId && adapter.delivery?.find(messageId);
    if ((!localDelivery || localDelivery.status === "failed") && preview?.actions?.send) {
      // Keep one unadmitted bubble and its real status until explicit Edit/discard.
      // A receipt:false user row is not acknowledgement of the pending words.
      turns = turns.map(turn => {
        const failed = turn.optimistic?.id === messageId && turn.optimistic.status === "failed";
        const unadmitted = turn.user?.receipt === false && String(turn.user.messageId || turn.user.id || "") === messageId;
        if (!failed && !unadmitted) return turn;
        return { ...turn, preview: true, previewMessage: preview, user: { ...turn.user, text: String(preview.text || "") } };
      });
    }
    const alreadyShown = messageId && (localDelivery || turns.some(turn => [
      turn.system, turn.user, turn.assistant, ...(turn.thinking || []), ...(turn.commentary || []), ...(turn.messages || [])
    ].some(message => String(message?.messageId || message?.id || "") === messageId &&
      (message.receipt !== false || turn.preview))));
    if (messageId && (preview?.text || preview?.actions?.editing) && !alreadyShown) {
      const user = { messageId, role: "user", text: String(preview.text || "") };
      turns = [...turns, { turnId: messageId, user, messages: [user], preview: true, previewMessage: preview,
        optimistic: { id: messageId, status: "pending" } }];
    }
  }
  // Transcription and interim replies are display only. The receipt watcher
  // receives canonical turns, never these presentation or delivery overlays.
  return { ...display, turns, welcomeMessage: turns.length ? "" : saved.welcomeMessage };
}

export { displayedConversation };
