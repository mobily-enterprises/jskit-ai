/**
 * The roles of a native Claude turn's assistant text. The text of an API message
 * waits until the message's end shows its role: progress (commentary) when a
 * tool call ends it, a reply (assistant) when it ends Claude's work.
 *
 * One reply comes before a tool call. Claude Code reads a message sent while it
 * works only after the running tool call returns (its replay arrives while an
 * earlier input of the loop has begun and has no result yet), answers it there
 * and works on. The first text Claude writes after reading such a message
 * answers that person, streamed or in one frame, even when a tool call follows
 * it: it is a reply, never progress. The reply is owed while that input belongs
 * to the running loop (`started`), so the loop's result or a Stop retires it.
 * @param {{
 *   roles: Map<string, string>,
 *   pending: Map<string, Array<Record<string, any>>>,
 *   started: Set<string>,
 *   messages: Map<string, Record<string, any>>,
 *   publishMessage: (message: Record<string, any>, emit: Function) => Promise<unknown>
 * }} turn The turn's decided roles and waiting text by API message, its running
 *   loop's inputs, its live messages and its publication.
 */
export function createClaudeAssistantRoles({ roles, pending, started, messages, publishMessage }) {
  let owed = "";

  // Claude reads input `uuid`; `started` still holds only the inputs it read before.
  function read(uuid) {
    if (started.size && !started.has(uuid)) owed = uuid;
  }

  // An API message's role once its end is known (`toolUse`: a tool call ends
  // it). `frame` may carry its text beside the call, written for input `input`.
  function role(apiMessageId, toolUse, frame = null, input = "") {
    const decided = roles.get(apiMessageId);
    if (decided) return decided;
    const answers = Boolean(owed) && started.has(owed) &&
      ((pending.get(apiMessageId) || []).some(block => block.userId === owed) ||
        input === owed && Boolean(frame?.message?.content?.some(block => block.type === "text" && block.text?.trim())));
    if (answers) owed = "";
    return toolUse && !answers ? "commentary" : "assistant";
  }

  // Publishes the text waiting for an API message in its role.
  async function flush(apiMessageId, messageRole, emit) {
    roles.set(apiMessageId, messageRole);
    const blocks = pending.get(apiMessageId) || [];
    pending.delete(apiMessageId);
    for (const block of blocks) {
      await publishMessage({ ...block, role: messageRole }, emit);
      if (block.outputId) {
        if (block.outputId !== block.id) messages.delete(block.outputId);
        await emit({ type: "message-complete", messageId: block.outputId });
      }
    }
  }

  return Object.freeze({
    read,
    role,
    flush
  });
}
