/** Reference adapter for transient conversations. Scope must be an app-issued string. */
export function createMemoryConversationStorage() {
  const conversations = new Map();
  const pending = new Map();

  function key(scope) {
    if (typeof scope !== "string" || !scope.trim()) throw new TypeError("Conversation scope must be a nonempty string.");
    return scope;
  }

  function transaction(turns) {
    return {
      async listTurnIds() { return [...turns.keys()]; },
      async nextTurnId() { return String(Math.max(0, ...[...turns.keys()].map(Number).filter(Number.isSafeInteger)) + 1).padStart(6, "0"); },
      async hasMessage(id) {
        return Boolean(id) && [...turns.values()].some((turn) => turn.messages.some((message) => message.messageId === id));
      },
      async readTurn(id) {
        const turn = turns.get(id);
        if (!turn) return null;
        const find = (role) => turn.messages.find((message) => message.role === role) || null;
        const thinking = turn.messages.filter((message) => message.role === "thinking");
        const commentary = turn.messages.filter((message) => message.role === "commentary");
        const activity = [...thinking, ...commentary].sort((a, b) => a.at.localeCompare(b.at));
        const system = find("system"), user = find("user"), assistant = find("assistant");
        return structuredClone({
          turnId: id, user, assistant, thinking, commentary,
          ...(system ? { system } : {}), ...(turn.metadata ? { metadata: turn.metadata } : {}),
          messages: [system, user, ...activity, assistant].filter(Boolean)
        });
      },
      async appendMessage(id, { turnMetadata, ...message }) {
        const turn = turns.get(id) || { messages: [] };
        if (turnMetadata) turn.metadata = structuredClone(turnMetadata);
        turn.messages.push(structuredClone(message));
        turns.set(id, turn);
      },
      async replaceAssistant(id, message) {
        if (!id) throw new TypeError("Assistant replacement requires a turn id.");
        const turn = turns.get(id) || { messages: [] };
        const previous = turn.messages.find((entry) => entry.role === "assistant");
        turn.messages = turn.messages.filter((entry) => entry.role !== "assistant");
        turn.messages.push({ ...previous, ...structuredClone(message), at: previous?.at || message.at });
        turns.set(id, turn);
      }
    };
  }

  async function write(scope, callback, remove = false) {
    const id = key(scope);
    const previous = pending.get(id) || Promise.resolve();
    const operation = previous.then(async () => {
      const draft = structuredClone(conversations.get(id) || new Map());
      const result = await callback(transaction(draft));
      if (remove) conversations.delete(id);
      else conversations.set(id, draft);
      return result;
    });
    const settled = operation.then(() => undefined, () => undefined);
    pending.set(id, settled);
    try { return await operation; }
    finally { if (pending.get(id) === settled) pending.delete(id); }
  }

  return Object.freeze({
    write,
    async read(scope, callback) {
      const id = key(scope);
      await pending.get(id);
      return callback(transaction(structuredClone(conversations.get(id) || new Map())));
    },
    async deleteConversation(scope) {
      await write(scope, async () => {}, true);
    }
  });
}
