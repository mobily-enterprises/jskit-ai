import { reactive, toRaw, toValue, watch } from "vue";

const messageText = value => String(value || "").trim();

function turnMatchesOptimisticMessage(turn = {}, optimistic = {}) {
  const authored = optimistic.origin === "application" ? turn.system : turn.user;
  const canonicalMessageId = messageText(authored?.messageId);
  const optimisticMessageId = messageText(optimistic.id);
  if (canonicalMessageId && optimisticMessageId) {
    return canonicalMessageId === optimisticMessageId;
  }
  if (messageText(authored?.text) !== optimistic.text) {
    return false;
  }
  const userAtMs = Date.parse(String(authored?.at || ""));
  return Number.isFinite(userAtMs) && userAtMs >= optimistic.createdAtMs - 5000;
}

function unmatchedOptimisticMessages(turns = [], optimisticMessages = [], { receiptsOnly = false } = {}) {
  const conversationTurns = Array.isArray(turns) ? turns : [];
  const matchedTurnIndexes = new Set();
  return (Array.isArray(optimisticMessages) ? optimisticMessages : []).filter((message) => {
    const turnIndex = conversationTurns.findIndex((turn, index) => (
      !matchedTurnIndexes.has(index) && turnMatchesOptimisticMessage(turn, message) &&
      (!receiptsOnly || message.status === "accepted" ||
        (message.origin === "application" ? turn.system : turn.user)?.receipt !== false)
    ));
    if (turnIndex < 0) {
      return true;
    }
    matchedTurnIndexes.add(turnIndex);
    return false;
  });
}

// One delivery state per conversation. The caller owns transport and receipts;
// the shared assistant element renders pending, failed and uncertain turns.
function createAssistantMessageDelivery({ deliver: defaultDeliver } = {}) {
  const state = reactive({ messages: [], sending: false });
  const acceptanceCallbacks = new WeakMap();
  let deliveryTail = null;
  let pendingSends = new Map();

  function find(messageId) {
    return state.messages.find((message) => message.id === messageId) || null;
  }

  function remove(messageId) {
    state.messages = state.messages.filter((message) => message.id !== messageId);
  }

  function reconcile(turns) {
    const unmatched = unmatchedOptimisticMessages(turns, state.messages, { receiptsOnly: true });
    const retained = new Set(unmatched.map(message => message.id));
    for (const message of state.messages) {
      if (!retained.has(message.id)) accept(message.id);
    }
    state.messages = unmatched;
  }

  function turns(savedTurns = []) {
    return [
      ...savedTurns.map(turn => {
        const message = state.messages.find(message => message.status !== "accepted" &&
          turnMatchesOptimisticMessage(turn, message) &&
          (message.origin === "application" ? turn.system : turn.user)?.receipt === false);
        if (!message) return turn;
        const pending = optimisticTurn(message);
        return { ...turn, optimistic: pending.optimistic, ...(pending.system ? { system: pending.system } : {}) };
      }),
      ...unmatchedOptimisticMessages(savedTurns, state.messages).map(optimisticTurn)
    ];
  }

  function optimisticTurn(message) {
    const role = message.origin === "application" ? "system" : "user";
    const authored = {
      attachments: message.attachments,
      at: message.createdAt,
      messageId: message.id,
      role,
      text: message.text
    };
    const status = message.status === "uncertain" ? {
      role: "system", text: "Message delivery is not confirmed.",
      delivery: { messageId: message.id, error: message.error, checking: message.checking === true }
    } : null;
    return {
      optimistic: { error: message.error, id: message.id, status: message.status },
      turnId: message.id,
      [role]: authored,
      ...(status ? { system: role === "system" ? { ...authored, ...status, text: `${authored.text}\n\n${status.text}` } : status } : {})
    };
  }

  async function send(payload, {
    messageId = crypto.randomUUID(),
    deliver = defaultDeliver,
    isCurrent = () => true,
    receiptTurns = null,
    onAccepted,
    uncertainOnError = false,
    queue = false
  } = {}) {
    if ((state.sending && !queue) || pendingSends.has(messageId) || find(messageId)?.status === "uncertain" ||
        (!messageText(payload?.message) && !payload?.displayAttachments?.length)) return false;
    if (typeof deliver !== "function") throw new TypeError("Message delivery requires a deliver function.");
    const snapshot = JSON.parse(JSON.stringify(payload));
    const previous = find(messageId);
    const acknowledge = previous && acceptanceCallbacks.get(toRaw(previous)) || onAccepted;
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
      text: String(snapshot.displayMessage || snapshot.message || "").trim()
    };
    if (typeof acknowledge === "function") acceptanceCallbacks.set(message, acknowledge);
    state.messages = [...state.messages.filter((entry) => entry.id !== messageId), message];
    state.sending = true;
    let stopReceipt;
    try {
      if (predecessor) await predecessor;
      if (!current()) return false;
      if (uncertainOnError && state.messages.some(entry => entry.id !== messageId && entry.status === "uncertain")) {
        fail(messageId, "Check the previous message's delivery before sending again.");
        return false;
      }
      let receipt;
      if (receiptTurns !== null) {
        receipt = Promise.withResolvers();
        settled.receipt = receipt;
        stopReceipt = watch([current, () => toValue(receiptTurns)], ([isCurrent, turns]) => {
          if (!isCurrent) receipt.resolve(false);
          else if (turns?.some(turn => turn.user?.messageId === messageId && turn.user.receipt !== false)) receipt.resolve({ ok: true });
        }, { immediate: true });
      }
      const submitted = deliver({ ...snapshot, messageId });
      const response = await (receipt ? Promise.race([submitted, receipt.promise]) : submitted);
      if (!current()) return false;
      if (response === false || response?.ok === false) {
        fail(messageId, response?.error || "Message could not be sent.", response?.status === "uncertain" ? "uncertain" : "failed");
      } else {
        accept(messageId);
      }
      return response;
    } catch (error) {
      if (!current()) return false;
      if (find(messageId)?.status === "accepted") return { ok: true };
      fail(messageId, error, uncertainOnError || error?.status === "uncertain" ? "uncertain" : "failed");
      throw error;
    } finally {
      stopReceipt?.();
      ownerPendingSends.delete(messageId);
      if (pendingSends === ownerPendingSends) {
        state.sending = ownerPendingSends.size > 0;
        if (!state.sending) deliveryTail = null;
      }
      settled.resolve();
    }
  }

  function fail(messageId, error, status = "failed") {
    const message = find(messageId);
    if (message && message.status !== "accepted") {
      message.error = String(error?.message || error || "Message could not be sent.").trim();
      message.status = status;
    }
  }

  function accept(messageId) {
    const message = find(messageId);
    if (message) { message.status = "accepted"; message.error = ""; }
    pendingSends.get(messageId)?.receipt?.resolve({ ok: true });
    if (message) {
      const entry = toRaw(message);
      const acknowledge = acceptanceCallbacks.get(entry);
      acceptanceCallbacks.delete(entry);
      acknowledge?.();
    }
  }

  function restoreUncertain(request, savedTurns = []) {
    const messageId = messageText(request?.messageId);
    if (!messageId || savedTurns.some(turn => (turn.user || turn.system)?.messageId === messageId &&
        (turn.user || turn.system).receipt !== false) ||
        find(messageId)?.status === "accepted") return false;
    if (!find(messageId)) {
      const payload = JSON.parse(JSON.stringify({ message: request.text || "", displayAttachments: request.attachments || [] }));
      const createdAt = request.at || new Date().toISOString();
      state.messages = [...state.messages, { id: messageId, payload, text: payload.message, origin: request.origin,
        attachments: payload.displayAttachments, createdAt, createdAtMs: Date.parse(createdAt),
        status: "uncertain", error: "" }];
    }
    fail(messageId, request.error || "Delivery could not be confirmed.", "uncertain");
    pendingSends.get(messageId)?.receipt?.resolve({ ok: false, status: "uncertain", error: request.error });
    return true;
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
    for (const pending of pendingSends.values()) {
      pending.receipt?.resolve(false);
      pending.resolve();
    }
    pendingSends = new Map();
    state.messages = [];
    state.sending = false;
  }

  return { accept, cancel, edit, find, reconcile, remove, resend, reset, restoreUncertain, send, state, turns };
}

export { createAssistantMessageDelivery, unmatchedOptimisticMessages };
export { retainAssistantConversation } from "./retainedConversation.js";
