import { effectScope, shallowReactive, watch } from "vue";
import { useVoiceConversation } from "./voiceConversation.js";

/** One controller per application shell. Bindings retain their own conversation. */
export function createVoiceConversationController({ connectSpeech, createSession = useVoiceConversation } = {}) {
  if (typeof connectSpeech !== "function") throw new TypeError("Voice requires an application speech connection.");
  const state = shallowReactive({ binding: null, session: null, visible: false, nextTarget: null, busy: false, error: "" });
  let scope;
  let revision = 0;
  let operations = Promise.resolve();
  let disposed = false;

  function serialize(operation) {
    const result = operations.then(operation);
    operations = result.catch(() => {});
    return result;
  }

  async function release() {
    const session = state.session;
    // Keep the old owner visible until microphone and playback cleanup finishes.
    if (session) await session.close();
    scope?.stop();
    scope = null;
    await state.binding?.release?.();
    state.binding = null;
    state.session = null;
  }

  async function activate(binding, requestRevision) {
    const socketUrl = await connectSpeech(binding);
    if (disposed || requestRevision !== revision) return false;
    if (!socketUrl) throw new Error("A speech service is not configured for this conversation.");
    await release();
    if (disposed || requestRevision !== revision) return false;
    const nextScope = effectScope(true);
    try {
      binding.retain?.();
      const session = nextScope.run(() => createSession(binding, { socketUrl }));
      scope = nextScope;
      state.binding = binding;
      state.session = session;
      state.visible = true;
      state.nextTarget = null;
      nextScope.run(() => watch(() => binding.available, (available) => {
        if (available !== false) return;
        state.error = "This conversation is no longer available for voice.";
        void end({ discard: true });
      }, { immediate: true }));
      return true;
    } catch (error) {
      nextScope.stop();
      binding.release?.();
      throw error;
    }
  }

  function open({ conversation } = {}) {
    if (!conversation?.id || !conversation.state || typeof conversation.submitText !== "function") {
      return Promise.reject(new TypeError("Voice requires a conversation identity, state and text submission."));
    }
    if (disposed) return Promise.reject(new Error("The voice host has been disposed."));
    const requestRevision = ++revision;
    return serialize(async () => {
      if (requestRevision !== revision || disposed) return false;
      state.error = "";
      if (state.binding?.id === conversation.id) {
        state.visible = true;
        state.nextTarget = null;
        return true;
      }
      if (conversation.available === false) throw new Error("This conversation is not available for voice.");
      if (state.session?.hasUnsentSpeech.value) {
        state.nextTarget = conversation;
        state.visible = true;
        return false;
      }
      state.busy = true;
      try { return await activate(conversation, requestRevision); }
      catch (error) { state.error = error.message; throw error; }
      finally { state.busy = false; }
    });
  }

  function switchTarget({ discard = false } = {}) {
    const target = state.nextTarget;
    if (!target) return Promise.resolve(false);
    if (!discard && state.session?.hasUnsentSpeech.value) return Promise.resolve(false);
    if (state.session?.sending.value) return Promise.resolve(false);
    const requestRevision = ++revision;
    return serialize(async () => {
      state.busy = true;
      try { return await activate(target, requestRevision); }
      catch (error) { state.error = error.message; throw error; }
      finally { state.busy = false; }
    });
  }

  function end({ discard = false } = {}) {
    if (!discard && state.session?.hasUnsentSpeech.value) {
      state.visible = true;
      state.error = "Finish or discard your recording before ending voice.";
      return Promise.resolve(false);
    }
    ++revision;
    return serialize(async () => {
      state.busy = true;
      try {
        await release();
        state.visible = false;
        state.nextTarget = null;
        return true;
      } finally { state.busy = false; }
    });
  }

  return {
    state, open, switchTarget, end,
    minimize() { state.visible = false; },
    reveal() { if (state.session) state.visible = true; },
    cancelSwitch() { state.nextTarget = null; },
    async dispose() { disposed = true; await end({ discard: true }); }
  };
}
