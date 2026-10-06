import { ASSISTANT_CONVERSATION_EVENT, ASSISTANT_CONVERSATION_SUBSCRIBE, ASSISTANT_CONVERSATION_UNSUBSCRIBE } from "../../src/shared/conversationRealtime.js";

// Controlled transport fixture. The production Socket.IO/auth/lifetime contract
// is exercised separately by assistantConversationSubscriptions.test.js.
export function createFixtureSocket() {
  const listeners = new Map();
  const subscriptions = new Map();
  const calls = [];
  const fire = (event, payload) => { for (const listener of [...listeners.get(event) || []]) listener(payload); };
  const socket = {
    connected: true,
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
    },
    off(event, listener) { listeners.get(event)?.delete(listener); },
    timeout() { return socket; },
    async emit(event, input, acknowledge) {
      calls.push({ event, input: structuredClone(input) });
      if (event === ASSISTANT_CONVERSATION_UNSUBSCRIBE) { subscriptions.delete(input.subscriptionId); return; }
      if (event !== ASSISTANT_CONVERSATION_SUBSCRIBE) throw new Error(`Unexpected fixture socket command ${event}`);
      const subscription = { ...input, epoch: crypto.randomUUID(), revision: 0 };
      subscriptions.set(input.subscriptionId, subscription);
      const response = await fetch(`/api/assistant/${input.targetSurfaceId}/conversations/${encodeURIComponent(input.conversationId)}`, {
        headers: { "x-jskit-surface": input.hostSurfaceId }
      });
      const state = await response.json();
      if (!subscriptions.has(input.subscriptionId)) return;
      acknowledge(null, response.ok ? { ok: true, streamEpoch: subscription.epoch, state }
        : { ok: false, error: state.error, status: response.status, code: state.code });
    },
    notify(conversationId, event = { type: "settled" }) {
      for (const subscription of subscriptions.values()) {
        if (conversationId && subscription.conversationId !== conversationId) continue;
        fire(ASSISTANT_CONVERSATION_EVENT, { subscriptionId: subscription.subscriptionId,
          conversationId: subscription.conversationId, streamEpoch: subscription.epoch,
          streamRevision: ++subscription.revision, event });
      }
    },
    reconnect() {
      socket.connected = false;
      subscriptions.clear();
      fire("disconnect", "transport close");
      socket.connected = true;
      fire("connect");
    },
    inspect() { return { active: subscriptions.size, calls, listeners: [...listeners.values()].reduce((sum, set) => sum + set.size, 0) }; }
  };
  return socket;
}
