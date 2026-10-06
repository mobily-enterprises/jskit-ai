/** Repository fixture for the original chat-service unit cases. The production
 * SQL adapter and common runtime run unchanged over these transactional rows.
 */
export function createMemoryAssistantRows({ id = "conversation_1", surfaceId = "assistant", messages = [] } = {}) {
  let state = { conversation: { id, workspaceId: null, createdByUserId: "1", surfaceId,
    title: "New conversation", status: "active", messageCount: 0, metadata: {} }, messages: [] };
  let pending = Promise.resolve();
  const read = options => options?.trx || state;
  const conversationsRepository = {
    async findById(value, options) { return value === id ? structuredClone(read(options).conversation) : null; },
    async findByIdForActorScope(value, scope, options) {
      const row = await this.findById(value, options);
      return row && scope.actorUserId === row.createdByUserId && scope.surfaceId === row.surfaceId && scope.workspaceId === row.workspaceId ? row : null;
    },
    async updateById(value, patch, options) {
      const target = read(options);
      if (value !== id) return null;
      Object.assign(target.conversation, structuredClone(patch));
      return structuredClone(target.conversation);
    },
    transaction(operation) {
      const next = pending.then(async () => {
        const trx = structuredClone(state);
        const value = await operation(trx);
        state = trx;
        messages.splice(0, messages.length, ...structuredClone(state.messages));
        return value;
      });
      pending = next.catch(() => {});
      return next;
    }
  };
  const messagesRepository = {
    async listByConversationScope(_id, _scope, { page, pageSize }, options) {
      return structuredClone(read(options).messages.slice((page - 1) * pageSize, page * pageSize));
    },
    async create(payload, options) {
      const rows = read(options).messages;
      const row = { ...structuredClone(payload), id: String(rows.length + 1), seq: rows.length + 1,
        clientMessageSid: payload.clientMessageSid || "", createdAt: payload.createdAt || new Date().toISOString() };
      rows.push(row);
      return structuredClone(row);
    },
    async updateById(value, patch, options) {
      const row = read(options).messages.find(message => message.id === value);
      Object.assign(row, structuredClone(patch));
      return structuredClone(row);
    }
  };
  return { conversationsRepository, messagesRepository };
}
