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

function conversationMessageIndex(record) {
  if (!record.index) {
    record.index = new Map();
    for (const [turnId, turn] of record.turns) {
      for (const message of turn.messages) {
        if (message.messageId && !record.index.has(message.messageId)) record.index.set(message.messageId, turnId);
      }
    }
  }
  return record.index;
}

/** Transaction implementation for single-writer record adapters. This serializes
 * one instance's writes; a database with multiple writers must also hold its own
 * transaction/lock across readRecord and writeRecord, or implement read/write directly.
 * An adapter may supply recordVersion(id), a cheap token that changes whenever
 * the saved record changes; the parsed record is then reused until it changes.
 */
export function createConversationStorage({ readRecord, writeRecord, deleteRecord, recordVersion }) {
  const pending = new Map();
  const cache = new Map();

  function key(scope) {
    if (typeof scope !== "string" || !scope.trim()) throw new TypeError("Conversation scope must be a nonempty string.");
    return scope;
  }

  async function readSaved(id) {
    if (typeof recordVersion !== "function") return readRecord(id);
    const version = await recordVersion(id);
    const cached = cache.get(id);
    if (version != null && cached?.version === version) return cached.record;
    const record = await readRecord(id);
    if (version == null) cache.delete(id);
    else cache.set(id, { version, record });
    return record;
  }

  // Saved records are shared and never changed in place. A transaction copies
  // the turn map and each turn it changes, then commits that new record.
  // Adapter fields the transaction does not manage are carried unchanged.
  function transaction(saved) {
    const { index: _index, ...draft } = saved;
    const added = new Map();
    let ownTurns = false;
    const owned = new Set();
    function ownTurn(id) {
      if (!ownTurns) {
        draft.turns = new Map(draft.turns);
        ownTurns = true;
      }
      const existing = draft.turns.get(id);
      if (existing && owned.has(id)) return existing;
      const turn = existing ? { ...existing, messages: [...existing.messages] } : { messages: [] };
      draft.turns.set(id, turn);
      owned.add(id);
      return turn;
    }
    function record() {
      // Index entries are verified against the turn on lookup, so removed
      // messages can remain listed; only additions need new entries.
      if (!added.size) return saved.index ? { ...draft, index: saved.index } : draft;
      const index = new Map(conversationMessageIndex(saved));
      for (const [messageId, turnId] of added) index.set(messageId, turnId);
      return { ...draft, index };
    }
    const turns = () => draft.turns;
    function messageTurnId(id) {
      if (!id) return "";
      const turnId = added.get(id) ?? conversationMessageIndex(saved).get(id);
      if (turnId === undefined) return "";
      const contains = (turn) => turn.messages.some((message) => message.messageId === id);
      if (turns().get(turnId) && contains(turns().get(turnId))) return turnId;
      return [...turns()].find(([, turn]) => contains(turn))?.[0] || "";
    }
    return {
      record,
      view: {
        async readMetadata() { return structuredClone(draft.metadata); },
        async writeMetadata(value) { draft.metadata = structuredClone(value); },
        async updateTurnMetadata(id, patch) {
          if (!turns().get(id)) throw new Error("The conversation turn does not exist.");
          const turn = ownTurn(id);
          turn.metadata = { ...turn.metadata, ...structuredClone(patch) };
        },
        async listTurnIds() { return [...turns().keys()]; },
        async nextTurnId() { return String(Math.max(0, ...[...turns().keys()].map(Number).filter(Number.isSafeInteger)) + 1).padStart(6, "0"); },
        async hasMessage(id) { return Boolean(messageTurnId(id)); },
        // Optional transaction extension: the turn holding this message ID.
        async findMessageTurnId(id) { return messageTurnId(id); },
        async readTurn(id) {
          const turn = turns().get(id);
          if (!turn) return null;
          const find = (role) => turn.messages.find((message) => message.role === role) || null;
          const thinking = turn.messages.filter((message) => message.role === "thinking");
          const commentary = turn.messages.filter((message) => message.role === "commentary");
          // Native continuations (for example Claude background-task notifications)
          // can add later replies to the same request turn. Every saved reply stays
          // in the ordered message list; the latest one still closes it.
          const replies = turn.messages.filter((message) => message.role === "assistant");
          const activity = [...thinking, ...commentary, ...replies.slice(0, -1)].sort((a, b) => a.at.localeCompare(b.at));
          const system = find("system"), user = find("user"), assistant = find("assistant");
          return structuredClone({
            turnId: id, user, assistant, thinking, commentary,
            ...(system ? { system } : {}), ...(turn.metadata ? { metadata: turn.metadata } : {}),
            messages: [system, user, ...activity, replies.at(-1)].filter(Boolean)
          });
        },
        async appendMessage(id, { turnMetadata, ...message }) {
          const turn = ownTurn(id);
          if (turnMetadata) turn.metadata = structuredClone(turnMetadata);
          const identity = conversationMessageStorageKey(message);
          const existing = identity === null ? -1 : turn.messages.findIndex((previous) =>
            conversationMessageStorageKey(previous) === identity);
          if (existing < 0) turn.messages.push(structuredClone(message));
          else turn.messages[existing] = structuredClone(message);
          if (message.messageId) added.set(message.messageId, id);
        },
        async replaceAssistant(id, message) {
          if (!id) throw new TypeError("Assistant replacement requires a turn id.");
          const turn = ownTurn(id);
          const previous = turn.messages.find((entry) => entry.role === "assistant");
          turn.messages = turn.messages.filter((entry) => entry.role !== "assistant");
          const replacement = { ...previous, ...structuredClone(message), at: previous?.at || message.at };
          turn.messages.push(replacement);
          if (replacement.messageId) added.set(replacement.messageId, id);
        }
      }
    };
  }


  async function write(scope, callback, remove = false) {
    const id = key(scope);
    const previous = pending.get(id) || Promise.resolve();
    const operation = previous.then(async () => {
      const draft = transaction(await readSaved(id));
      const result = await callback(draft.view);
      // A failed or partial save leaves the cached record unknown.
      cache.delete(id);
      if (remove) await deleteRecord(id);
      else {
        const record = draft.record();
        await writeRecord(id, record, draft.view);
        const version = typeof recordVersion === "function" ? await recordVersion(id) : null;
        if (version != null) cache.set(id, { version, record });
      }
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
      return callback(transaction(await readSaved(id)).view);
    },
    async deleteConversation(scope) {
      await write(scope, async () => {}, true);
    }
  });
}
