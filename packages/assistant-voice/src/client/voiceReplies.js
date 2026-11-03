import { computed, ref } from "vue";
import { createVoiceTurnId } from "./browser.js";
import { speechTextFromAssistant, takeStreamingSpeech, VOICE_MAX_SPEECH_TEXT_CHARACTERS } from "../shared/protocol.js";
import { createConversationNarrationTracker } from "./conversationNarration.js";
import { useJskitText, voiceErrorText, voiceSpeechWording } from "./i18n.js";

/**
 * What a voice session says aloud: the conversation's assistant replies, streamed into speech as they arrive, and the
 * optional narration of the agent's activity, with the read-aloud choice and sound unlocking that govern both. The
 * session's watchers call into it, so their order stays the session's.
 * @param {{
 *   binding: import("./types.js").VoiceConversationBinding,
 *   voice: import("./types.js").VoiceTransport,
 *   readAloud: import("vue").Ref<boolean>,
 *   error: import("vue").Ref<string>,
 *   starting: import("vue").Ref<boolean>,
 *   capturing: import("vue").ComputedRef<boolean>,
 *   speechActive: import("vue").ComputedRef<boolean>,
 *   narrationPageVisible: import("vue").Ref<boolean>,
 *   hiddenNarrationPage: import("vue").ComputedRef<boolean>,
 *   closed: () => boolean
 * }} dependencies
 */
function useVoiceReplies({ binding, voice, readAloud, error, starting, capturing, speechActive, narrationPageVisible, hiddenNarrationPage, closed }) {
  const { t } = useJskitText();
  const readAloudChangePending = computed(() => binding.readAloudChangePending === true);
  const soundPreparing = ref(false);
  let soundRevision = 0;
  const conversationId = binding.conversationId || binding.id;
  let primed = false;
  let draining = false;
  const seen = new Set();
  const speechQueue = [];
  const replies = new Map();
  let speechSuppressed = false;
  let requestedMessageId = "";
  let speechInvitation = "";
  let lastStreamingId = "";
  const narrationTracker = createConversationNarrationTracker();
  let narrationSettleTimer;
  let thinkingMurmurTimer;
  let narrationEpoch = 0;

  function clearNarrationTimers() {
    ++narrationEpoch;
    clearTimeout(narrationSettleTimer);
    clearTimeout(thinkingMurmurTimer);
  }
  function retireNarration(selected = () => true) {
    for (let index = speechQueue.length - 1; index >= 0; --index) {
      const reply = speechQueue[index];
      if (!reply.narrationKind || !selected(reply.narrationKind)) continue;
      cancelReply(reply, "narration-retired");
      speechQueue.splice(index, 1);
      if (reply.turnId && voice.activeSpeechTurnId.value === reply.turnId) voice.stopSpeaking("narration-retired");
    }
  }
  function narrationEnabled() {
    const narration = binding.narration;
    return Boolean(narration && narration.eligible && !narration.loading && readAloud.value
      && binding.state.available !== false && narrationPageVisible.value && !capturing.value
      && !starting.value && !speechSuppressed && !closed());
  }
  function queueNarration(kind, text) {
    // Optional activity uses the original queue but never impersonates a canonical output.
    if (!narrationEnabled()) return;
    // Only filler yields to queued speech. Actual messages keep arrival order.
    if (kind === "murmur" && (speechQueue.length || speechActive.value)) return;
    speechQueue.push({ narrationKind: kind, raw: text, consumed: 0, final: true, started: false });
    void drainSpeech();
  }
  function observeNarration(settled = false, enabled = narrationEnabled()) {
    const narration = binding.narration;
    if (!narration) return;
    const entries = narrationTracker.observe(narration.turns, {
      includeFinals: false, settled, enabled,
      vocalizeThinking: narration.vocalizeThinking,
      vocalizeInterimTurns: narration.vocalizeInterimTurns
    });
    for (const entry of entries) queueNarration(entry.kind, entry.text);
  }
  function scheduleThinkingMurmur(epoch) {
    const narration = binding.narration;
    if (!narrationEnabled() || !narration.working || !narration.thinkingSounds) return;
    thinkingMurmurTimer = setTimeout(() => {
      if (epoch !== narrationEpoch || !narrationEnabled() || !binding.narration?.working || !binding.narration.thinkingSounds) return;
      if (!speechQueue.length && !draining && !speechActive.value && voice.state.value === "idle") {
        queueNarration("murmur", t("jskit.assistant.voice.narration.murmur"));
      }
      scheduleThinkingMurmur(epoch);
    }, 20_000);
  }
  function refreshNarration(settled = false) {
    clearNarrationTimers();
    observeNarration(settled);
    const narration = binding.narration;
    if (!narrationEnabled() || !narration.working) return;
    const epoch = narrationEpoch;
    if (narration.vocalizeThinking || narration.vocalizeInterimTurns) {
      narrationSettleTimer = setTimeout(() => {
        if (epoch === narrationEpoch && narrationEnabled()) observeNarration(true);
      }, 700);
    }
    scheduleThinkingMurmur(epoch);
  }

  function observe(callback, value) {
    try {
      // readable-check: allow optional-call - optional operation: a binding may leave out onPlayback or onReadAloudChange, and is then not told
      Promise.resolve(callback?.(value)).catch(() => {});
    } catch {
      // Observers cannot take ownership of scheduling or cleanup.
    }
  }
  function emitReply(reply, phase, reason) {
    if (reply.terminal || (phase === "started" && reply.audible)) return;
    if (phase === "started") reply.audible = true;
    else reply.terminal = true;
    if (reply.narrationKind) return;
    observe(binding.onPlayback, {
      conversationId, outputId: reply.outputId, phase, ...(reason ? { reason } : {})
    });
  }
  function receivePlayback(event) {
    const reply = [...replies.values()].find(reply => reply.turnId === event.turnId)
      || speechQueue.find(reply => reply.narrationKind && reply.turnId === event.turnId);
    if (!reply) return;
    if (event.phase === "completed") {
      reply.drained = true;
      if (reply.canonicalFinal || reply.narrationKind) emitReply(reply, "completed");
    } else emitReply(reply, event.phase, event.reason);
  }
  function cancelReply(reply, reason = "cancelled", phase = "interrupted") {
    reply.cancelled = true;
    emitReply(reply, phase, reason);
  }
  function stopSpeech() { cancelSpeech(); }
  function cancelSpeech(reason = "cancelled", phase = "interrupted") {
    clearNarrationTimers();
    retireNarration();
    for (const reply of replies.values()) {
      if (!reply.terminal) cancelReply(reply, reason, phase);
    }
    speechQueue.length = 0;
    speechSuppressed = true;
    speechInvitation = "";
    voice.stopSpeaking(reason);
  }
  function inviteSpeech(messageId) {
    // Only a new request from this page can lift silence. A delayed admission,
    // history refresh or retry of the same request is not a new invitation.
    if (!messageId || messageId === requestedMessageId || seen.has(messageId)) return;
    requestedMessageId = messageId;
    speechInvitation = messageId;
  }
  async function drainSpeech() {
    if (draining || closed() || !readAloud.value || speechSuppressed || soundPreparing.value || voice.playbackBlocked.value) return;
    draining = true;
    const wording = voiceSpeechWording();
    try {
      while (speechQueue.length) {
        const reply = speechQueue[0];
        if (reply.cancelled) { speechQueue.shift(); continue; }
        if (reply.started && !speechActive.value) { speechQueue.shift(); continue; }
        if (speechActive.value && !reply.started) return;
        if (reply.started && !voice.canAppendSpeech.value) return;
        const previousSpeech = reply.narrationKind ? "" : speechTextFromAssistant(reply.raw.slice(0, reply.consumed), undefined, wording);
        const maximumCharacters = reply.narrationKind ? (reply.started ? 140 : 64) : Math.max(1, Math.min(
          reply.started ? 140 : 64,
          VOICE_MAX_SPEECH_TEXT_CHARACTERS - previousSpeech.length,
          VOICE_MAX_SPEECH_TEXT_CHARACTERS - reply.spokenCharacters
        ));
        const chunk = reply.speechCapped ? null : takeStreamingSpeech(reply.raw.slice(reply.consumed), reply.final, maximumCharacters, wording);
        if (!chunk) {
          if (reply.final && reply.started) voice.endSpeech();
          else if (reply.final) {
            cancelReply(reply, "no-audio");
            speechQueue.shift();
            continue;
          }
          return;
        }
        reply.consumed += chunk.consumed;
        let text = chunk.text;
        if (!reply.narrationKind) {
          // Keep offsets in raw Markdown. The original limit applies after its
          // cleanup, including whitespace between separately streamed phrases.
          const speech = speechTextFromAssistant(reply.raw.slice(0, reply.consumed), undefined, wording);
          const boundary = speech.startsWith(previousSpeech)
            ? speech.slice(previousSpeech.length).match(/^\s*/u)[0].length : 0;
          text = text.slice(0, Math.max(0, Math.min(
            VOICE_MAX_SPEECH_TEXT_CHARACTERS - previousSpeech.length - boundary,
            VOICE_MAX_SPEECH_TEXT_CHARACTERS - reply.spokenCharacters
          )));
          reply.spokenCharacters += text.length;
          reply.speechCapped = speech.length >= VOICE_MAX_SPEECH_TEXT_CHARACTERS
            || reply.spokenCharacters >= VOICE_MAX_SPEECH_TEXT_CHARACTERS;
          reply.final ||= reply.speechCapped;
        }
        if (!text) continue;
        if (!reply.started) {
          reply.started = true;
          reply.turnId = createVoiceTurnId("speak");
          const accepted = await voice.speak(text, reply.turnId, { stream: true });
          if (closed()) return;
          if (reply.cancelled) {
            if (reply.narrationKind) continue;
            return;
          }
          if (accepted === false) {
            cancelReply(reply, "no-audio");
            continue;
          }
        } else if (!voice.appendSpeech(text)) return;
        if (reply.speechCapped || (reply.final && reply.consumed >= reply.raw.length)) { voice.endSpeech(); return; }
      }
    } catch (cause) { error.value = voiceErrorText(cause); stopSpeech(); }
    finally { draining = false; }
  }
  function queueReply(message, final) {
    let reply = replies.get(message.id);
    if (!reply) {
      if (!primed || !readAloud.value || speechSuppressed || seen.has(message.id) || (!final && message.autonomous)) return;
      retireNarration(kind => kind === "murmur");
      reply = {
        id: message.id, outputId: message.outputId || message.id, streamId: message.streamId,
        raw: "", consumed: 0, spokenCharacters: 0, speechCapped: false,
        final: false, canonicalFinal: false, started: false
      };
      replies.set(message.id, reply);
      speechQueue.push(reply);
    }
    if (reply.cancelled) return;
    if (hiddenNarrationPage.value && !reply.canonicalFinal && (final || !reply.raw)) {
      // Consume hidden outputs without replay; a streaming answer cannot claim
      // completion when its first canonical final was not admitted for speech.
      cancelReply(reply, "page-hidden");
      if (reply.turnId && voice.activeSpeechTurnId.value === reply.turnId) voice.stopSpeaking("page-hidden");
      return;
    }
    if (final) retireNarration(kind => kind === "murmur");
    const text = String(message.text || "").slice(0, VOICE_MAX_SPEECH_TEXT_CHARACTERS * 2);
    const spokenPrefix = reply.raw.slice(0, reply.consumed);
    if (!text.startsWith(spokenPrefix) && !(final && text.trimEnd() === spokenPrefix.trimEnd())) {
      // A model revision cannot unsay words. Retire that projection; never splice
      // its old prefix onto a different answer or replay it as a second answer.
      cancelReply(reply);
      if (speechQueue[0] === reply) voice.stopSpeaking();
      return;
    }
    reply.consumed = Math.min(reply.consumed, text.length);
    reply.raw = text;
    reply.canonicalFinal ||= final;
    reply.final = final || reply.speechCapped || text.length >= VOICE_MAX_SPEECH_TEXT_CHARACTERS * 2;
    if (reply.canonicalFinal && reply.drained) emitReply(reply, "completed");
  }
  async function enableSound() {
    const revision = ++soundRevision;
    soundPreparing.value = true;
    try {
      await voice.preparePlayback();
    } catch {
      // Requested sound stays on; its recovery control remains available.
    } finally {
      if (revision === soundRevision && !closed()) {
        soundPreparing.value = false;
        void drainSpeech();
      }
    }
  }
  async function toggleReadAloud() {
    if (readAloudChangePending.value) return;
    error.value = "";
    readAloud.value = !readAloud.value;
    observe(binding.onReadAloudChange, readAloud.value);
    await applyReadAloud();
  }
  async function applyReadAloud() {
    if (!readAloud.value) {
      ++soundRevision;
      soundPreparing.value = false;
      cancelSpeech("muted");
      return;
    }
    speechSuppressed = false;
    speechInvitation = "";
    await enableSound();
    if (!closed()) refreshNarration();
  }

  function currentSpokenText() {
    const reply = speechQueue[0];
    return reply ? reply.raw.slice(0, reply.consumed).slice(-2000) : "";
  }
  /**
   * Queues the assistant replies of the conversation's latest history for speech, once each, and forgets what the
   * history no longer holds.
   * @param {import("./types.js").VoiceConversationMessage[]} messages
   * @param {import("./types.js").VoiceConversationMessage | null | undefined} reply The reply streaming now.
   */
  function observeHistory(messages, reply) {
    let invited = false;
    for (const message of messages) {
      // Unadmitted local records do not acknowledge a request or lift speech silence.
      if (message.role === "user" && message.receipt === false) continue;
      if (seen.has(message.id)) continue;
      if (message.role === "user" && message.id === speechInvitation) {
        speechSuppressed = false;
        speechInvitation = "";
        invited = true;
      }
      if (message.role === "assistant") queueReply(message, true);
      seen.add(message.id);
    }
    if (lastStreamingId && lastStreamingId !== reply?.id && !messages.some(message => message.id === lastStreamingId)) {
      const retired = replies.get(lastStreamingId);
      if (retired && !retired.canonicalFinal && !retired.cancelled) {
        cancelReply(retired);
        if (speechQueue[0] === retired) voice.finishCurrentPhrase();
      }
    }
    lastStreamingId = reply?.id || "";
    if (reply?.text) {
      queueReply(reply, reply.status === "completed");
      if (!readAloud.value || !primed || reply.autonomous || hiddenNarrationPage.value) seen.add(reply.id);
    }
    // Keep only the visible history plus active playback receipts in memory.
    const retained = new Set([...messages.map((message) => message.id), reply?.id, ...speechQueue.map((item) => item.id),
      ...[...replies.values()].filter(item => !item.terminal).map(item => item.id)]);
    for (const id of seen) if (!retained.has(id)) seen.delete(id);
    for (const id of replies.keys()) if (!retained.has(id)) replies.delete(id);
    primed = true;
    if (invited) refreshNarration();
    void drainSpeech();
  }

  /**
   * The narration settings the session watches, with whether narration may speak now.
   * @returns {Record<string, unknown>}
   */
  function narrationSettings() {
    const narration = binding.narration;
    return {
      id: binding.id, conversationId: binding.conversationId, narration,
      loading: narration?.loading, eligible: narration?.eligible, working: narration?.working,
      thinking: narration?.vocalizeThinking, interim: narration?.vocalizeInterimTurns,
      sounds: narration?.thinkingSounds, turns: narration?.turns, enabled: narrationEnabled()
    };
  }

  /**
   * Retires narration the new settings no longer allow and observes what they now allow, without replaying history.
   * @param {Record<string, any>} current
   * @param {Record<string, any> | undefined} previous
   */
  function applyNarrationSettings(current, previous) {
    clearNarrationTimers();
    if (!current.narration || current.loading || current.id !== previous?.id || current.conversationId !== previous?.conversationId) {
      narrationTracker.reset();
      retireNarration();
      if (!current.narration || current.loading) return;
    }
    if (!current.enabled) retireNarration();
    else retireNarration(kind => kind === "thinking" ? !current.thinking
      : kind === "commentary" ? !current.interim : !current.sounds || !current.working);
    // Retire disabled tails before enabling a flag; settings are not a request to replay history.
    if (previous && (current.enabled !== previous.enabled || current.thinking !== previous.thinking || current.interim !== previous.interim)) observeNarration(true, false);
    refreshNarration(!current.enabled);
  }

  return {
    applyNarrationSettings,
    applyReadAloud,
    cancelSpeech,
    currentSpokenText,
    drainSpeech,
    enableSound,
    inviteSpeech,
    narrationSettings,
    observeHistory,
    readAloudChangePending,
    receivePlayback,
    soundPreparing,
    stopSpeech,
    toggleReadAloud
  };
}

export { useVoiceReplies };
