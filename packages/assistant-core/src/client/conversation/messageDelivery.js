import { reactive } from "vue";

const messageText = value => String(value || "").trim();

function turnMatchesOptimisticMessage(turn = {}, optimistic = {}) {
  const canonicalMessageId = messageText(turn?.user?.messageId);
  const optimisticMessageId = messageText(optimistic.id);
  if (canonicalMessageId && optimisticMessageId) {
    return canonicalMessageId === optimisticMessageId;
  }
  if (messageText(turn?.user?.text) !== optimistic.text) {
    return false;
  }
  const userAtMs = Date.parse(String(turn?.user?.at || ""));
  return Number.isFinite(userAtMs) && userAtMs >= optimistic.createdAtMs - 5000;
}

function unmatchedOptimisticMessages(turns = [], optimisticMessages = []) {
  const conversationTurns = Array.isArray(turns) ? turns : [];
  const matchedTurnIndexes = new Set();
  return (Array.isArray(optimisticMessages) ? optimisticMessages : []).filter((message) => {
    const turnIndex = conversationTurns.findIndex((turn, index) => (
      !matchedTurnIndexes.has(index) && turnMatchesOptimisticMessage(turn, message)
    ));
    if (turnIndex < 0) {
      return true;
    }
    matchedTurnIndexes.add(turnIndex);
    return false;
  });
}

// One delivery state per conversation. The caller owns transport and receipts;
// the shared assistant element renders these pending and failed turns.
function createAssistantMessageDelivery({ deliver: defaultDeliver } = {}) {
  const state = reactive({ messages: [], sending: false });
  let deliveryTail = null;
  let pendingSends = new Map();

  function find(messageId) {
    return state.messages.find((message) => message.id === messageId) || null;
  }

  function remove(messageId) {
    state.messages = state.messages.filter((message) => message.id !== messageId);
  }

  function reconcile(turns) {
    state.messages = unmatchedOptimisticMessages(turns, state.messages);
  }

  function turns(savedTurns = []) {
    return [
      ...savedTurns,
      ...unmatchedOptimisticMessages(savedTurns, state.messages).map((message) => ({
        optimistic: { error: message.error, id: message.id, status: message.status },
        turnId: message.id,
        user: {
          attachments: message.attachments,
          at: message.createdAt,
          messageId: message.id,
          role: "user",
          text: message.text
        }
      }))
    ];
  }

  async function send(payload, {
    messageId = crypto.randomUUID(),
    deliver = defaultDeliver,
    isCurrent = () => true,
    queue = false
  } = {}) {
    if ((state.sending && !queue) || pendingSends.has(messageId) || !messageText(payload?.message)) return false;
    if (typeof deliver !== "function") throw new TypeError("Message delivery requires a deliver function.");
    const snapshot = JSON.parse(JSON.stringify(payload));
    const ownerPendingSends = pendingSends;
    const current = () => pendingSends === ownerPendingSends && isCurrent();
    const predecessor = deliveryTail;
    const settled = Promise.withResolvers();
    deliveryTail = settled.promise;
    ownerPendingSends.set(messageId, settled);
    const now = new Date();
    const message = {
      attachments: snapshot.displayAttachments || [],
      createdAt: now.toISOString(),
      createdAtMs: now.getTime(),
      error: "",
      id: messageId,
      payload: snapshot,
      status: "pending",
      text: String(snapshot.displayMessage || snapshot.message).trim()
    };
    state.messages = [...state.messages.filter((entry) => entry.id !== messageId), message];
    state.sending = true;
    try {
      if (predecessor) await predecessor;
      if (!current()) return false;
      const response = await deliver({ ...snapshot, messageId });
      if (!current()) return false;
      if (response === false || response?.ok === false) {
        fail(messageId, response?.error || "Message could not be sent.");
      } else {
        const acceptedMessage = find(messageId);
        if (acceptedMessage) acceptedMessage.status = "accepted";
      }
      return response;
    } catch (error) {
      if (!current()) return false;
      fail(messageId, error);
      throw error;
    } finally {
      ownerPendingSends.delete(messageId);
      if (pendingSends === ownerPendingSends) {
        state.sending = ownerPendingSends.size > 0;
        if (!state.sending) deliveryTail = null;
      }
      settled.resolve();
    }
  }

  function fail(messageId, error) {
    const message = find(messageId);
    if (message) {
      message.error = String(error?.message || error || "Message could not be sent.").trim();
      message.status = "failed";
    }
  }

  function cancel(messageId) {
    if (find(messageId)?.status !== "failed") return false;
    remove(messageId);
    return true;
  }

  function edit(messageId, draft = "") {
    const message = find(messageId);
    if (!message || !cancel(messageId)) return null;
    return !draft || draft.startsWith(message.text) ? draft || message.text : `${message.text}\n\n${draft}`;
  }

  function resend(messageId, { queue = false } = {}) {
    const message = find(messageId);
    if (message?.status !== "failed") return false;
    return send(message.payload, { messageId, queue });
  }

  function reset() {
    deliveryTail = null;
    for (const pending of pendingSends.values()) pending.resolve();
    pendingSends = new Map();
    state.messages = [];
    state.sending = false;
  }

  return { cancel, edit, find, reconcile, remove, resend, reset, send, state, turns };
}

export { createAssistantMessageDelivery, unmatchedOptimisticMessages };
