function messagesForTurn(turn) {
  return turn.messages || [
    turn.system,
    turn.user,
    ...(turn.thinking || []),
    ...(turn.commentary || []),
    turn.assistant
  ].filter(Boolean);
}

/** Overlay live provider output without changing the saved transcript. */
export function mergeConversationStream(turns = [], snapshot = {}) {
  const savedIds = new Set(turns.flatMap(messagesForTurn).map((message) => message.messageId));
  const messages = (snapshot?.messages || []).filter((message) => message.text && !savedIds.has(message.messageId));
  if (!messages.length) return turns;
  const result = [...turns];
  for (const message of messages) {
    const tail = result.at(-1);
    const turn = tail && !tail.assistant && !tail.system
      ? { ...tail, messages: [...messagesForTurn(tail)] }
      : { turnId: `stream:${message.messageId}`, messages: [] };
    if (turn.turnId === tail?.turnId) result[result.length - 1] = turn;
    else result.push(turn);
    turn.messages.push(message);
    turn.pending = true;
    if (message.role === "assistant") turn.assistant = message;
    else turn.commentary = [...(turn.commentary || []), message];
  }
  return result;
}
