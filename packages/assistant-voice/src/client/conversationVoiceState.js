/** Canonical history is authoritative; only user and assistant output is spoken. */
export function projectConversationVoiceState({ turns = [], status = "ready", interimReply = null } = {}) {
  const messages = [];
  let streamingReply = null;
  for (const turn of turns) {
    if (turn.user) messages.push({ ...turn.user, role: "user", id: turn.user.messageId || `${turn.turnId}:user` });
    if (turn.assistant?.text) {
      const reply = { ...turn.assistant, role: "assistant", id: turn.assistant.outputId || `${turn.turnId}:assistant` };
      if (turn.pending || ["starting", "inProgress"].includes(reply.status)) {
        // Production notifications kept live output separate until their saved reply.
        if (reply.origin === "application") Object.assign(reply, { id: `${reply.id}:stream`, autonomous: true });
        streamingReply = reply;
      }
      else messages.push(reply);
    }
  }
  return { messages, streamingReply: interimReply ? { ...interimReply, id: interimReply.outputId || interimReply.id } : streamingReply, status };
}
