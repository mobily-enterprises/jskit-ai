import { AsyncLocalStorage } from "node:async_hooks";

const conversationMessageRoles = ["assistant", "commentary", "system", "thinking", "user"];

export function createConversationOperationLease() {
  let resolveIdle = () => null;
  const idle = new Promise((resolve) => {
    resolveIdle = resolve;
  });
  return {
    idle,
    operations: 0,
    resolveIdle
  };
}

export function beginConversationOperation(lease) {
  lease.operations += 1;
  return {
    active: true
  };
}

export function finishConversationOperation(lease, participant) {
  participant.active = false;
  lease.operations -= 1;
  if (lease.operations === 0) {
    lease.resolveIdle();
  }
}

/** Nested native store operations share the host's current transaction. The
 * supplied storage remains the only writer queue and commit/rollback owner.
 */
export function createReentrantConversationStorage(storage) {
  if (typeof storage?.read !== "function" || typeof storage?.write !== "function") {
    throw new TypeError("Conversation storage requires read(scope, callback) and write(scope, callback).");
  }
  const mutationContext = new AsyncLocalStorage();

  function inherited(scope) {
    const context = mutationContext.getStore();
    return context?.scope === scope && context.participant?.active === true ? context : null;
  }

  async function participate(context, operation) {
    const participant = beginConversationOperation(context.lease);
    try {
      return await mutationContext.run({ ...context, participant }, () => operation(context.transaction));
    } finally {
      finishConversationOperation(context.lease, participant);
    }
  }

  return Object.freeze({
    ...storage,
    read(scope, operation) {
      const context = inherited(scope);
      return context ? participate(context, operation) : storage.read(scope, operation);
    },
    write(scope, operation) {
      const context = inherited(scope);
      if (context) return participate(context, operation);
      return storage.write(scope, async transaction => {
        const lease = createConversationOperationLease();
        const participant = beginConversationOperation(lease);
        try {
          return await mutationContext.run({ scope, transaction, lease, participant }, () => operation(transaction));
        } finally {
          finishConversationOperation(lease, participant);
          await lease.idle;
        }
      });
    },
    ...(typeof storage.deleteConversation === "function"
      ? { deleteConversation: scope => storage.deleteConversation(scope) } : {})
  });
}

function conversationMessageStorageKey({ role, at, messageId } = {}) {
  const normalizedRole = String(role || "").trim();
  if (!conversationMessageRoles.includes(normalizedRole)) return null;
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const timestamp = date.toISOString().replace(/[-:]/gu, "").replace(".", "");
  const normalizedMessageId = String(messageId || "").trim();
  const idSuffix = normalizedMessageId ? `.${normalizedMessageId}` : "";
  // The original transcript overwrote this same role/timestamp/id file. Its
  // filesystem suffix restrictions do not apply to record-native message IDs.
  return `${normalizedRole}.${timestamp}${idSuffix}.md`;
}

/** Transaction implementation for single-writer record adapters. This serializes
 * one instance's writes; a database with multiple writers must also hold its own
 * transaction/lock across readRecord and writeRecord, or implement read/write directly.
 */
export function createConversationStorage({ readRecord, writeRecord, deleteRecord }) {
  const pending = new Map();

  function key(scope) {
    if (typeof scope !== "string" || !scope.trim()) throw new TypeError("Conversation scope must be a nonempty string.");
    return scope;
  }

  function transaction(record) {
    const turns = record.turns;
    return {
      async readMetadata() { return structuredClone(record.metadata); },
      async writeMetadata(value) { record.metadata = structuredClone(value); },
      async updateTurnMetadata(id, patch) {
        const turn = turns.get(id);
        if (!turn) throw new Error("The conversation turn does not exist.");
        turn.metadata = { ...turn.metadata, ...structuredClone(patch) };
      },
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
        const identity = conversationMessageStorageKey(message);
        const existing = identity === null ? -1 : turn.messages.findIndex((previous) =>
          conversationMessageStorageKey(previous) === identity);
        if (existing < 0) turn.messages.push(structuredClone(message));
        else turn.messages[existing] = structuredClone(message);
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
      const draft = structuredClone(await readRecord(id));
      const view = transaction(draft);
      const result = await callback(view);
      if (remove) await deleteRecord(id);
      else await writeRecord(id, draft, view);
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
      return callback(transaction(structuredClone(await readRecord(id))));
    },
    async deleteConversation(scope) {
      await write(scope, async () => {}, true);
    }
  });
}
