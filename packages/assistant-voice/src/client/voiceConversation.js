import { computed, onScopeDispose, ref, watch } from "vue";
import { useVoiceTransport } from "./voiceTransport.js";
import { speechTextFromAssistant, takeStreamingSpeech, VOICE_MAX_SPEECH_TEXT_CHARACTERS } from "../shared/protocol.js";
import { createConversationNarrationTracker } from "./conversationNarration.js";

/** Created inside the controller's effect scope, independent of a mounted screen. */
export function useVoiceConversation(binding, { socketUrl, createTransport = useVoiceTransport } = {}) {
  const oneOffTalkMode = computed(() => binding.defaults?.talkMode === "hold" ? "hold" : "tap");
  const targetLabel = computed(() => binding.label || "Assistant");
  const readAloud = ref(binding.defaults?.readAloud === true);
  const readAloudChangePending = computed(() => binding.readAloudChangePending === true);
  const soundPreparing = ref(false);
  let soundRevision = 0;
  const conversationId = binding.conversationId || binding.id;
  const error = ref("");
  const pendingTranscript = ref(null);
  const heldReview = ref(false);
  const holding = ref(false);
  const sending = ref(false);
  const takingTranscript = ref(false);
  const live = ref(false);
  const starting = ref(false);
  const callMode = ref(binding.defaults?.mode === "hands-free" ? "hands-free" : "push-to-talk");
  const changingCallMode = ref(false);
  const pushHolding = ref(false);
  let pushInput = null;
  let startupAbort = null;
  let decidedCandidate = "";
  let stopTimer;
  let committing = null;
  const voice = createTransport({
    socketUrl,
    voiceId: binding.defaults?.voiceId || "",
    speechEnabled: readAloud,
    interruptSpeechOnListen: false,
    autoReconnect: true,
    onPlayback: receivePlayback
  });
  watch([() => binding.defaults?.voiceId, voice.availableVoices], ([voiceId, voices]) => {
    if (voiceId === undefined) return;
    voice.selectedVoice.value = !voices.length || voices.some(voice => voice.id === voiceId) ? voiceId : "";
  });
  const microphoneMuted = voice.microphoneMuted;
  const capturing = computed(() => voice.captureState.value !== "idle");
  const speechActive = computed(() => Boolean(voice.activeSpeechTurnId.value));
  const talkLabel = computed(() => voice.listening.value ? "Send recording"
    : capturing.value ? "Cancel recording" : `Talk to ${targetLabel.value}`);
  const liveLabel = computed(() => starting.value ? "Cancel voice startup" : live.value ? "End voice" : "Start voice");
  const callConnection = computed(() => {
    if (voice.reconnecting.value) return "Voice interrupted";
    if (error.value || voice.error.value) return "Voice needs attention";
    if (starting.value) return "Starting voice…";
    if (live.value) return "Voice active";
    return "Voice off";
  });
  const callStatus = computed(() => {
    if (voice.reconnecting.value) return "Reconnecting…";
    if (starting.value) return "Starting voice…";
    if (live.value && voice.captureState.value === "connecting") return "Connecting…";
    if (live.value && voice.captureState.value === "opening") return "Opening microphone…";
    if (error.value || voice.error.value) return "Voice needs attention";
    if (!live.value) return "";
    if (pushHolding.value && voice.listening.value) return "Listening to you";
    if (voice.speaking.value) return `${targetLabel.value} is speaking`;
    if (speechActive.value) return "Preparing speech…";
    if (binding.state.status === "working") return "Thinking";
    if (sending.value) return "Sending your message…";
    if (pendingTranscript.value) return "Review your message below";
    if (microphoneMuted.value) return "Microphone muted";
    if (voice.captureState.value === "transcribing") return "Transcribing…";
    if (voice.listening.value) return "Listening to you";
    return callMode.value === "push-to-talk" ? "Hold to speak" : "Preparing microphone…";
  });
  const callDetail = computed(() => {
    if (voice.reconnecting.value) return "Waiting for the voice connection. Your unfinished words remain available for review.";
    if (error.value || voice.error.value) return "Review your message below or try voice again.";
    if (starting.value || live.value && ["connecting", "opening"].includes(voice.captureState.value)) return "Allow microphone access if your browser asks.";
    if (!live.value) return "";
    if (microphoneMuted.value) return "Unmute when you want to speak. You can still listen.";
    if (!readAloud.value) return "Sound is off. Answers still appear in chat.";
    if (callMode.value === "push-to-talk") return "Hold to speak. Release to send. The conversation stays open.";
    return "You can speak naturally, including while I reply.";
  });
  const callModeBusy = computed(() => starting.value || changingCallMode.value || pushHolding.value || sending.value || Boolean(pendingTranscript.value)
    || capturing.value && Boolean(voice.partialTranscript.value.trim()) || capturing.value && !voice.listening.value);
  const microphoneStatus = computed(() => microphoneMuted.value ? "Microphone muted" : voice.listening.value ? "Microphone on" : "Microphone off");
  const avatarVisual = computed(() => ({
    avatar: binding.avatar,
    state: voice.speaking.value ? "speaking" : pushHolding.value && voice.listening.value ? "listening" : binding.state.status === "working" ? "thinking"
      : voice.listening.value && !microphoneMuted.value ? "listening" : "idle",
    mouthLevel: voice.mouthLevel.value,
    mouthPose: voice.mouthPose.value
  }));
  const callAudioLevel = computed(() => Math.max(0, Math.min(1, voice.speaking.value ? voice.mouthLevel.value
    : voice.listening.value && !microphoneMuted.value ? voice.inputLevel.value : 0)));
  const status = computed(() => {
    const capture = { connecting: "Connecting…", opening: "Opening mic…", listening: "Listening", transcribing: "Transcribing…" }[voice.captureState.value];
    return [starting.value ? "Starting voice…" : "", voice.reconnecting.value ? "Reconnecting…" : "", live.value ? "Live conversation" : "", microphoneMuted.value ? "Microphone muted" : capture, voice.speaking.value ? "Speaking" : speechActive.value ? "Preparing speech…" : ""].filter(Boolean).join(" · ");
  });
  const heldTranscript = computed(() => pendingTranscript.value?.text ||
    (["listening", "transcribing"].includes(voice.captureState.value) ? voice.partialTranscript.value : ""));
  const voiceWords = computed(() => heldTranscript.value || binding.state.messages?.findLast(message => message.role === "user")?.text || "");
  const voiceAnswer = computed(() => binding.state.streamingReply?.text || binding.state.messages?.findLast(message => message.role === "assistant")?.text || "");
  let recording = null;
  let primed = false;
  let draining = false;
  let disposed = false;
  const seen = new Set();
  const speechQueue = [];
  const replies = new Map();
  let speechSuppressed = false;
  let requestedMessageId = "";
  let speechInvitation = "";
  let lastStreamingId = "";
  const narrationTracker = createConversationNarrationTracker();
  const narrationPageVisible = ref(globalThis.document?.visibilityState !== "hidden");
  const hiddenNarrationPage = computed(() => Boolean(binding.narration) && !narrationPageVisible.value);
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
      && !starting.value && !speechSuppressed && !disposed);
  }
  function queueNarration(kind, text) {
    // Optional activity uses the original queue but never impersonates a canonical output.
    if (!narrationEnabled() || speechQueue.some(reply => !reply.narrationKind)
      || speechActive.value && !speechQueue.some(reply => reply.narrationKind && reply.turnId === voice.activeSpeechTurnId.value)) return;
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
      if (!speechQueue.length && !draining && !speechActive.value && voice.state.value === "idle") queueNarration("murmur", "Hmm...");
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
    if (draining || disposed || !readAloud.value || speechSuppressed || soundPreparing.value || voice.playbackBlocked?.value) return;
    draining = true;
    try {
      while (speechQueue.length) {
        const reply = speechQueue[0];
        if (reply.cancelled) { speechQueue.shift(); continue; }
        if (reply.started && !speechActive.value) { speechQueue.shift(); continue; }
        if (speechActive.value && !reply.started) return;
        if (reply.started && !voice.canAppendSpeech.value) return;
        const previousSpeech = reply.narrationKind ? "" : speechTextFromAssistant(reply.raw.slice(0, reply.consumed));
        const maximumCharacters = reply.narrationKind ? (reply.started ? 140 : 64) : Math.max(1, Math.min(
          reply.started ? 140 : 64,
          VOICE_MAX_SPEECH_TEXT_CHARACTERS - previousSpeech.length,
          VOICE_MAX_SPEECH_TEXT_CHARACTERS - reply.spokenCharacters
        ));
        const chunk = reply.speechCapped ? null : takeStreamingSpeech(reply.raw.slice(reply.consumed), reply.final, maximumCharacters);
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
          const speech = speechTextFromAssistant(reply.raw.slice(0, reply.consumed));
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
          reply.turnId = crypto.randomUUID();
          const accepted = await voice.speak(text, reply.turnId, { stream: true });
          if (disposed) return;
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
    } catch (cause) { error.value = cause.message; stopSpeech(); }
    finally { draining = false; }
  }
  function queueReply(message, final) {
    let reply = replies.get(message.id);
    if (!reply) {
      if (!primed || !readAloud.value || speechSuppressed || seen.has(message.id) || (!final && message.autonomous)) return;
      retireNarration();
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
    if (final) retireNarration();
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
      if (revision === soundRevision && !disposed) {
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
    if (!disposed) refreshNarration();
  }
  watch(() => binding.defaults?.readAloud, (value) => {
    if (disposed || typeof value !== "boolean" || value === readAloud.value) return;
    readAloud.value = value;
    void applyReadAloud();
  });
  async function deliverTranscript() {
    const pending = pendingTranscript.value;
    if (!pending || sending.value) return;
    sending.value = true;
    error.value = "";
    try {
      inviteSpeech(pending.messageId);
      const receipt = await binding.submitText(pending.text, { messageId: pending.messageId, context: pending.focus });
      if (receipt === false || receipt?.ok === false) throw new Error(receipt?.message || "The conversation did not accept this message. Review it before retrying.");
      if (pendingTranscript.value === pending) dismissTranscript();
    } catch (cause) { if (pendingTranscript.value === pending) error.value = cause.message; }
    finally { sending.value = false; }
  }
  async function cancelRecording() {
    startupAbort?.abort();
    startupAbort = null;
    starting.value = false;
    releaseEditCapturePause();
    recording = null;
    await voice.cancelListening();
  }
  async function discardRecording() {
    live.value = false;
    committing = null;
    clearTimeout(stopTimer);
    await cancelRecording();
  }
  function dismissTranscript() {
    releaseEditCapturePause();
    pendingTranscript.value = null;
    heldReview.value = false;
    holding.value = false;
    error.value = "";
  }
  function releaseEditCapturePause() {
    const pending = pendingTranscript.value;
    const captureId = pending?.editPausedCaptureId;
    if (!captureId) return;
    delete pending.editPausedCaptureId;
    if (recording?.messageId === captureId && !disposed && live.value && callMode.value === "hands-free") {
      voice.setMicrophoneMuted(false);
    }
  }
  async function talk() {
    error.value = "";
    try {
      if (voice.listening.value) { await voice.stopListening(); return; }
      if (capturing.value) { await discardRecording(); return; }
      if (pendingTranscript.value) return;
      await startRecording(false);
    } catch (cause) { recording = null; error.value = cause.message; }
  }
  async function startRecording(reviewBeforeSend, continuous = false) {
    if (disposed || hiddenNarrationPage.value || starting.value || microphoneMuted.value || capturing.value || committing ||
        (pendingTranscript.value || sending.value) && !(continuous && live.value && (callMode.value === "hands-free" || pushHolding.value))) return;
    error.value = "";
    reviewBeforeSend ||= binding.defaults?.reviewBeforeSend === true;
    heldReview.value = reviewBeforeSend;
    holding.value = reviewBeforeSend;
    // Keep the starting target even if navigation changes during this utterance.
    const next = { focus: { ...(binding.captureContext?.() || {}) }, messageId: crypto.randomUUID(), started: false, reviewBeforeSend, continuous };
    recording = next;
    try {
      const started = await voice.startListening({ continuous });
      if (recording === next) { next.started = started; if (!started) recording = null; }
    } catch (cause) { if (recording === next) { recording = null; error.value = cause.message; } }
  }
  async function toggleMicrophoneMuted({ preserveBuffered = false } = {}) {
    // A person's explicit microphone choice supersedes an Edit-owned pause.
    if (pendingTranscript.value) delete pendingTranscript.value.editPausedCaptureId;
    voice.setMicrophoneMuted(!microphoneMuted.value, { preserveBuffered });
    if (!microphoneMuted.value && recording) delete recording.finishAfterPending;
    clearTimeout(stopTimer);
    if (microphoneMuted.value && starting.value) await cancelRecording();
    else if (!microphoneMuted.value && live.value && callMode.value === "hands-free" && !capturing.value) await startRecording(false, true);
  }
  async function changeCallMode(mode) {
    if (!["push-to-talk", "hands-free"].includes(mode) || mode === callMode.value || callModeBusy.value || committing) return;
    changingCallMode.value = true;
    callMode.value = mode;
    try {
      if (capturing.value) await cancelRecording();
      if (live.value && mode === "hands-free" && !microphoneMuted.value) await startRecording(false, true);
    } finally { changingCallMode.value = false; }
  }
  async function startPushToTalk(event) {
    if (event?.repeat || event?.isPrimary === false || event?.button !== undefined && event.button !== 0 || pushHolding.value
      || disposed || hiddenNarrationPage.value || starting.value
      || capturing.value && !voice.listening.value || committing) return;
    if (event?.pointerId !== undefined) event.currentTarget.setPointerCapture(event.pointerId);
    pushInput = event?.pointerId ?? event?.key ?? null;
    pushHolding.value = true;
    callMode.value = "push-to-talk";
    voice.setMicrophoneMuted(false);
    if (recording) delete recording.finishAfterPending;
    if (!live.value) await toggleLive();
    if (!pushHolding.value || !live.value || disposed) return;
    // A hold can take over an open hands-free microphone without throwing away
    // its current words. Release then finalizes that same recording once.
    if (recording && voice.listening.value) {
      recording.continuous = false;
      return;
    }
    await startRecording(false, Boolean(pendingTranscript.value || sending.value));
    if (!recording) pushHolding.value = false;
  }
  async function finishPushToTalk(event) {
    if (!pushHolding.value || event && (event.pointerId ?? event.key ?? null) !== pushInput) return;
    pushHolding.value = false;
    pushInput = null;
    try {
      if (voice.listening.value && (pendingTranscript.value || sending.value || committing)) {
        if (recording) recording.finishAfterPending = true;
        voice.setMicrophoneMuted(true, { preserveBuffered: true });
        return;
      }
      if (voice.listening.value) await voice.stopListening();
      else await cancelRecording();
    } catch (cause) { await cancelRecording(); error.value = cause.message; }
  }
  async function cancelPushToTalk(event) {
    if (!pushHolding.value || event?.pointerId !== undefined && event.pointerId !== pushInput) return;
    pushHolding.value = false;
    pushInput = null;
    await cancelRecording();
  }
  async function toggleHandsFree() {
    if (disposed || hiddenNarrationPage.value || pushHolding.value) return;
    if (live.value && callMode.value === "hands-free" && voice.listening.value && (pendingTranscript.value || sending.value || committing)) {
      // Pause must finish the newer recording after the existing admission,
      // without replacing the one pending transcript or stopping output.
      if (!microphoneMuted.value && recording) recording.finishAfterPending = true;
      await toggleMicrophoneMuted({ preserveBuffered: true });
      return;
    }
    if (committing) return;
    if (starting.value) { await cancelRecording(); return; }
    if (capturing.value && !voice.listening.value) return;
    if (live.value && callMode.value === "hands-free") {
      if (!microphoneMuted.value && voice.listening.value) {
        // Stop new input immediately, retaining the captured tail for the
        // original Stop drain. Resuming starts a fresh recording.
        voice.setMicrophoneMuted(true, { preserveBuffered: true });
        await voice.stopListening();
      } else if (microphoneMuted.value) await toggleMicrophoneMuted();
      else await startRecording(false, true);
      return;
    }
    if (callMode.value === "hands-free" && (pendingTranscript.value || sending.value)) {
      voice.setMicrophoneMuted(false);
      await toggleLive();
      return;
    }
    if (pendingTranscript.value || sending.value || callModeBusy.value) return;
    voice.setMicrophoneMuted(false);
    await changeCallMode("hands-free");
    if (!live.value) await toggleLive();
  }
  async function toggleLive() {
    error.value = "";
    if (starting.value) { await cancelRecording(); return; }
    if (live.value) {
      live.value = false;
      pushHolding.value = false;
      committing = null;
      clearTimeout(stopTimer);
      await cancelRecording();
      return;
    }
    if (disposed || hiddenNarrationPage.value || microphoneMuted.value || capturing.value || committing ||
        (pendingTranscript.value || sending.value) && callMode.value !== "hands-free" && !pushHolding.value) return;
    const controller = new AbortController();
    startupAbort = controller;
    starting.value = true;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    try {
      // Unlock requested sound in the gesture without delaying microphone startup.
      if (readAloud.value) void enableSound();
      signal.throwIfAborted();
      await voice.connect();
      signal.throwIfAborted();
      if (disposed) return;
      starting.value = false;
      live.value = true;
      if (callMode.value === "hands-free") {
        await startRecording(false, true);
        if (startupAbort === controller && !recording?.started) live.value = false;
      }
    } catch (cause) {
      if (startupAbort === controller && !controller.signal.aborted) {
        live.value = false;
        error.value = signal.aborted ? "Voice setup took too long. Try Talk again." : cause.message;
      }
    } finally {
      if (startupAbort === controller) { startupAbort = null; starting.value = false; }
    }
  }
  function currentSpokenText() {
    const reply = speechQueue[0];
    return reply ? reply.raw.slice(0, reply.consumed).slice(-2000) : "";
  }
  function explicitSilence(text) {
    return /^(?:please )?(?:st[oa]p (?:talking|speaking)|be quiet|wait[, ]+let me (?:explain|finish)|let me finish)[.!]?$/iu.test(text.trim());
  }
  function decideTurn() {
    const candidate = voice.endpoint.value;
    if (takingTranscript.value || !live.value || callMode.value !== "hands-free" || !voice.listening.value || microphoneMuted.value || pendingTranscript.value || sending.value || !candidate) return;
    const key = `${candidate.turnId}:${candidate.revision}`;
    if (decidedCandidate === key) return;
    decidedCandidate = key;
    const captured = { focus: { ...(recording?.focus || (binding.captureContext?.() || {})) }, messageId: recording?.messageId || crypto.randomUUID(), text: candidate.text,
      ...(recording?.reviewBeforeSend ? { reviewBeforeSend: true } : {}) };
    try {
      const text = candidate.text.trim();
      const spoken = currentSpokenText();
      if (explicitSilence(text)) {
        if (!spoken.toLowerCase().includes(text.toLowerCase())) stopSpeech();
        voice.finishUtterance(candidate, { discard: true });
        return;
      }
      // Keep hesitation in the current utterance. Never drop short answers such
      // as yes/no or corrections; the conversation model interprets them.
      if (/(?:^|\s)(?:u+m+|u+h+|e+r+|h+m+)[.!?,…]*$/iu.test(text)) return;
      const acknowledgement = speechActive.value && !spoken.includes("?") && /^(?:m+[- ]?h*m+|u+h[- ]?huh)[.!?,]*$/iu.test(text);
      const words = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const spokenWords = spoken.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const echo = speechActive.value && words.split(" ").length >= 4 && ` ${spokenWords} `.includes(` ${words} `);
      if (!words || /^\[(?:cough|sneeze|noise|silence)\]$/iu.test(text) || acknowledgement || echo) {
        voice.finishUtterance(candidate, { discard: true });
        return;
      }
      committing = { ...captured, turnId: candidate.turnId, revision: candidate.revision };
      if (!voice.finishUtterance(candidate)) { committing = null; return; }
      publishTranscript();
      // The daemon rechecks the endpoint revision before returning final text.
      // Ordinary steering leaves the current answer and queued audio intact.
    } catch (cause) {
      if (live.value && candidate === voice.endpoint.value) {
        live.value = false;
        if (recording) recording.reviewBeforeSend = true;
        error.value = `${cause.message} Tap the microphone to finish and review this recording.`;
      }
    }
  }
  watch([voice.endpoint, pendingTranscript, sending, takingTranscript], decideTurn);
  watch(voice.completedUtterance, (utterance) => {
    if (!utterance || !live.value || !committing || committing.turnId !== utterance.turnId || committing.revision !== utterance.revision) return;
    pendingTranscript.value = { ...committing, text: utterance.text };
    committing = null;
    if (!pendingTranscript.value.reviewBeforeSend) void deliverTranscript();
    else holding.value = false;
  });
  watch(voice.utteranceReset, (reset) => {
    // A discard can lose a race with resumed speech. Keep this utterance's
    // identity and destination until the daemon acknowledges the boundary.
    if (reset?.turnId !== voice.activeListenTurnId.value || !live.value || !recording) return;
    recording = { focus: { ...(binding.captureContext?.() || {}) }, messageId: crypto.randomUUID(), started: true, continuous: true,
      ...(recording.reviewBeforeSend ? { reviewBeforeSend: true } : {}),
      ...(recording.finishAfterPending ? { finishAfterPending: true } : {}) };
  });
  watch(voice.partialTranscript, (text, previous) => {
    clearTimeout(stopTimer);
    if (!live.value || microphoneMuted.value) return;
    if (text && !previous && recording) recording.focus = { ...(binding.captureContext?.() || {}) };
    if (!explicitSilence(text) || currentSpokenText().toLowerCase().includes(text.toLowerCase())) return;
    stopTimer = setTimeout(() => {
      if (live.value && !microphoneMuted.value && voice.partialTranscript.value === text) stopSpeech();
    }, 120);
  });
  watch([pendingTranscript, sending, voice.utteranceReset, voice.utteranceStale], () => {
    const stale = voice.utteranceStale.value;
    if (committing && stale?.turnId === committing.turnId && stale.revision === committing.revision) {
      committing = null;
    }
    if (!disposed && live.value && !pushHolding.value && !changingCallMode.value &&
        !pendingTranscript.value && !sending.value && !committing && microphoneMuted.value &&
        recording?.finishAfterPending && voice.listening.value) {
      // Retire intent before the asynchronous PCM drain so a receipt/reset
      // cannot finalize this capture twice. Its original final watcher sends B.
      delete recording.finishAfterPending;
      void voice.stopListening().catch(cause => { error.value = cause.message; });
      return;
    }
    if (live.value && callMode.value === "hands-free" && !changingCallMode.value && !microphoneMuted.value && !capturing.value && !pendingTranscript.value && !sending.value && !voice.error.value) void startRecording(false, true);
  });
  async function startHeldRecording() { await startRecording(true); }
  async function finishHeldRecording() {
    holding.value = false;
    if (!recording?.reviewBeforeSend) return;
    try {
      if (voice.listening.value) await voice.stopListening();
      else {
        await cancelRecording();
        error.value = "The microphone was not ready. Hold the avatar again to record.";
      }
    } catch (cause) { await cancelRecording(); error.value = cause.message; }
  }
  async function discardHeldRecording() {
    if (sending.value) return;
    await cancelRecording();
    dismissTranscript();
  }
  watch([voice.captureState, voice.transcript, voice.error], () => {
    if (!recording?.started || capturing.value) return;
    const finished = recording;
    recording = null;
    if (voice.error.value) {
      if (committing?.messageId === finished.messageId) committing = null;
      live.value = false;
      const text = voice.partialTranscript.value.trim() || voice.transcript.value.trim();
      if (text) {
        pendingTranscript.value = { ...finished, text, reviewBeforeSend: true };
        holding.value = false;
        error.value = "The connection interrupted this recording. These words may be incomplete. Review before sending, or discard and record again.";
      }
      return;
    }
    const text = voice.transcript.value.trim();
    if (!text) {
      if (!finished.continuous) error.value = "No speech was recognized. Try again.";
      return;
    }
    if (live.value && !finished.reviewBeforeSend && explicitSilence(text)) {
      stopSpeech();
      return;
    }
    pendingTranscript.value = { ...finished, text };
    if (!finished.reviewBeforeSend) void deliverTranscript();
    else holding.value = false;
  });
  watch(() => ({ messages: binding.state.messages, reply: binding.state.streamingReply,
    text: binding.state.streamingReply?.text }), ({ messages = [], reply }) => {
    if (!binding.id) return;
    // Reconcile an uncertain send by identity, never by equal transcript text.
    if (pendingTranscript.value && messages.some((message) => message.role === "user" && message.id === pendingTranscript.value.messageId && message.receipt !== false)) {
      dismissTranscript();
    }
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
  }, { immediate: true });
  watch(() => {
    const narration = binding.narration;
    return {
      id: binding.id, conversationId: binding.conversationId, narration,
      loading: narration?.loading, eligible: narration?.eligible, working: narration?.working,
      thinking: narration?.vocalizeThinking, interim: narration?.vocalizeInterimTurns,
      sounds: narration?.thinkingSounds, turns: narration?.turns, enabled: narrationEnabled()
    };
  }, (current, previous) => {
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
  }, { immediate: true, deep: true });
  watch(voice.error, (message) => { if (message) cancelSpeech("playback-error", "failed"); });
  watch(() => error.value || voice.error.value, (message) => { if (message) binding.onError?.(message); });
  watch([voice.activeSpeechTurnId, voice.canAppendSpeech], () => { void drainSpeech(); });
  function currentTranscript() {
    const pending = pendingTranscript.value;
    const currentWords = recording && ["listening", "transcribing"].includes(voice.captureState.value)
      && voice.partialTranscript.value && recording.messageId !== pending?.messageId;
    return currentWords ? { id: recording.messageId, text: voice.partialTranscript.value }
      : pending ? { id: pending.messageId, text: pending.text } : null;
  }
  function canTakeTranscript(messageId) {
    return !disposed && !starting.value && !sending.value && !committing && !takingTranscript.value
      && (pendingTranscript.value?.messageId === messageId || currentTranscript()?.id === messageId)
      && !binding.state.messages?.some(message => message.role === "user" && message.id === messageId && message.receipt !== false);
  }
  async function beginTranscriptEdit(messageId) {
    if (!canTakeTranscript(messageId)) return false;
    const pending = pendingTranscript.value;
    if (pending && pending.messageId !== messageId) return false;
    const selected = pending ? { id: pending.messageId, text: pending.text } : currentTranscript();
    const capture = recording;
    takingTranscript.value = true;
    try {
      // Retain the selected words and destination before cancelling capture.
      // The existing pending-clear watcher resumes hands-free after resolution.
      pendingTranscript.value = {
        ...(pending?.messageId === messageId ? pending : capture),
        messageId, text: selected.text, reviewBeforeSend: true, editing: true
      };
      if (capture) {
        if (capture.messageId !== messageId && live.value && callMode.value === "hands-free") {
          // Newer continuous words retain their recording identity and endpoint.
          if (!microphoneMuted.value) {
            pendingTranscript.value.editPausedCaptureId = capture.messageId;
            voice.setMicrophoneMuted(true);
          }
        } else if (pushHolding.value) await cancelPushToTalk();
        else await cancelRecording();
      }
      return true;
    } finally { takingTranscript.value = false; }
  }
  async function takeTranscript(messageId, transfer) {
    if (!canTakeTranscript(messageId)) return false;
    const pending = pendingTranscript.value;
    const selected = pending?.messageId === messageId ? { id: messageId, text: pending.text } : currentTranscript();
    takingTranscript.value = true;
    try {
      // The host rechecks its draft and transfers synchronously before cancellation.
      if (transfer && transfer(selected.text) !== true) return false;
      if (pendingTranscript.value?.messageId === messageId) dismissTranscript();
      else if (recording?.messageId === messageId) {
        if (pushHolding.value) await cancelPushToTalk();
        else await cancelRecording();
        if (!disposed && live.value && callMode.value === "hands-free" && !microphoneMuted.value) {
          await startRecording(false, true);
        }
      }
      return true;
    } finally { takingTranscript.value = false; }
  }
  function publishTranscript() {
    const transcript = currentTranscript();
    binding.onTranscript?.(transcript, { canTake: Boolean(transcript && canTakeTranscript(transcript.id)) });
  }
  watch([pendingTranscript, voice.captureState, voice.partialTranscript, voice.endpoint, sending, starting, takingTranscript], publishTranscript, { immediate: true });
  watch(avatarVisual, (visual) => binding.onVisual?.(visual), { immediate: true });
  const page = globalThis.window || globalThis;
  const updateNarrationVisibility = () => {
    narrationPageVisible.value = globalThis.document?.visibilityState !== "hidden";
    if (disposed || !hiddenNarrationPage.value || !(recording || starting.value || committing || capturing.value)) return;
    // This is the original document-hidden capture boundary, not avatar/body
    // visibility. Retire B before cancellation; A's delivery stays untouched.
    pushHolding.value = false;
    pushInput = null;
    if (!pendingTranscript.value) {
      holding.value = false;
      heldReview.value = false;
    }
    void discardRecording();
    voice.stopSpeaking("page-hidden");
  };
  globalThis.document?.addEventListener?.("visibilitychange", updateNarrationVisibility);
  const cancelStartup = () => { if (starting.value) void discardRecording(); else void cancelPushToTalk(); };
  page.addEventListener?.("pagehide", cancelStartup);
  page.addEventListener?.("blur", cancelPushToTalk);
  onScopeDispose(() => {
    globalThis.document?.removeEventListener?.("visibilitychange", updateNarrationVisibility);
    page.removeEventListener?.("pagehide", cancelStartup);
    page.removeEventListener?.("blur", cancelPushToTalk);
    startupAbort?.abort(); startupAbort = null;
    stopSpeech();
    binding.onTranscript?.(null); binding.onVisual?.(null); disposed = true; live.value = false; clearTimeout(stopTimer); recording = null; speechQueue.length = 0;
  });

  async function close() {
    startupAbort?.abort();
    disposed = true;
    live.value = false;
    clearTimeout(stopTimer);
    recording = null;
    committing = null;
    stopSpeech();
    await voice.close();
  }
  function editTranscript(text, messageId = pendingTranscript.value?.messageId) {
    if (pendingTranscript.value && pendingTranscript.value.messageId === messageId && !sending.value) pendingTranscript.value = { ...pendingTranscript.value, text: String(text) };
  }
  const composerBlocked = computed(() => starting.value ||
    (!live.value || callMode.value !== "hands-free") &&
      (sending.value || Boolean(pendingTranscript.value) || capturing.value));
  const hasUnsentSpeech = computed(() => capturing.value || starting.value || sending.value || Boolean(pendingTranscript.value));
  return {
    oneOffTalkMode, targetLabel, voice, readAloud, readAloudChangePending, error, pendingTranscript, heldReview, holding, sending,
    live, starting, callMode, changingCallMode, pushHolding, microphoneMuted, capturing,
    speechActive, talkLabel, liveLabel, callConnection, callStatus, callDetail, callModeBusy,
    microphoneStatus, avatarVisual, callAudioLevel, status, heldTranscript, voiceWords, voiceAnswer,
    stopSpeech, inviteSpeech, toggleReadAloud, enableSound, soundPreparing, deliverTranscript, cancelRecording,
    discardRecording, dismissTranscript, talk, toggleMicrophoneMuted, changeCallMode,
    startPushToTalk, finishPushToTalk, cancelPushToTalk, toggleLive, toggleHandsFree, startHeldRecording,
    finishHeldRecording, discardHeldRecording, close, editTranscript, canTakeTranscript, beginTranscriptEdit, takeTranscript, hasUnsentSpeech, composerBlocked
  };
}
