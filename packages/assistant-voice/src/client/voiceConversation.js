import { computed, onScopeDispose, ref, watch } from "vue";
import { useVoiceTransport } from "./voiceTransport.js";
import { listenToDocument, listenToPage, pageVisible } from "./browser.js";
import { useJskitText, voiceErrorText } from "./i18n.js";
import { useVoiceReplies } from "./voiceReplies.js";

/**
 * One voice session for a conversation binding: capture and turn-taking for what the person says, the replies the
 * assistant speaks (voiceReplies.js), and the status the voice view shows. Created inside the controller's effect
 * scope, independent of a mounted screen.
 * @param {import("./types.js").VoiceConversationBinding} binding
 * @param {{ socketUrl: string, createTransport?: typeof useVoiceTransport }} options
 */
export function useVoiceConversation(binding, { socketUrl, createTransport = useVoiceTransport }) {
  const { serverMessage, t } = useJskitText();
  const targetLabel = computed(() => binding.label || t("jskit.assistant.voice.assistant"));
  const readAloud = ref(binding.defaults?.readAloud === true);
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
    onPlayback: (event) => replies.receivePlayback(event)
  });
  watch([() => binding.defaults?.voiceId, voice.availableVoices], ([voiceId, voices]) => {
    if (voiceId === undefined) return;
    voice.selectedVoice.value = !voices.length || voices.some(voice => voice.id === voiceId) ? voiceId : "";
  });
  const microphoneMuted = voice.microphoneMuted;
  const capturing = computed(() => voice.captureState.value !== "idle");
  const speechActive = computed(() => Boolean(voice.activeSpeechTurnId.value));
  const callConnection = computed(() => {
    if (voice.reconnecting.value) return t("jskit.assistant.voice.status.interrupted");
    if (error.value || voice.error.value) return t("jskit.assistant.voice.status.needsAttention");
    if (starting.value) return t("jskit.assistant.voice.status.starting");
    if (live.value) return t("jskit.assistant.voice.status.active");
    return t("jskit.assistant.voice.status.off");
  });
  const callStatus = computed(() => {
    if (voice.reconnecting.value) return t("jskit.assistant.voice.status.reconnecting");
    if (starting.value) return t("jskit.assistant.voice.status.starting");
    if (live.value && voice.captureState.value === "connecting") return t("jskit.assistant.voice.status.connecting");
    if (live.value && voice.captureState.value === "opening") return t("jskit.assistant.voice.status.openingMicrophone");
    if (error.value || voice.error.value) return t("jskit.assistant.voice.status.needsAttention");
    if (!live.value) return "";
    if (pushHolding.value && voice.listening.value) return t("jskit.assistant.voice.status.listeningToYou");
    if (voice.speaking.value) return t("jskit.assistant.voice.status.targetSpeaking", { target: targetLabel.value });
    if (speechActive.value) return t("jskit.assistant.voice.status.preparingSpeech");
    if (binding.state.status === "working") return t("jskit.assistant.voice.status.thinking");
    if (sending.value) return t("jskit.assistant.voice.status.sending");
    if (pendingTranscript.value) return t("jskit.assistant.voice.status.review");
    if (microphoneMuted.value) return t("jskit.assistant.voice.status.microphoneMuted");
    if (voice.captureState.value === "transcribing") return t("jskit.assistant.voice.status.transcribing");
    if (voice.listening.value) return t("jskit.assistant.voice.status.listeningToYou");
    return callMode.value === "push-to-talk"
      ? t("jskit.assistant.voice.status.holdToSpeak")
      : t("jskit.assistant.voice.status.preparingMicrophone");
  });
  const callModeBusy = computed(() => starting.value || changingCallMode.value || pushHolding.value || sending.value || Boolean(pendingTranscript.value)
    || capturing.value && Boolean(voice.partialTranscript.value.trim()) || capturing.value && !voice.listening.value);
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
    const capture = {
      connecting: "jskit.assistant.voice.status.connecting",
      opening: "jskit.assistant.voice.status.openingMic",
      listening: "jskit.assistant.voice.status.listening",
      transcribing: "jskit.assistant.voice.status.transcribing"
    }[voice.captureState.value];
    return [
      starting.value ? "jskit.assistant.voice.status.starting" : "",
      voice.reconnecting.value ? "jskit.assistant.voice.status.reconnecting" : "",
      live.value ? "jskit.assistant.voice.status.live" : "",
      microphoneMuted.value ? "jskit.assistant.voice.status.microphoneMuted" : capture,
      voice.speaking.value ? "jskit.assistant.voice.status.speaking" : speechActive.value ? "jskit.assistant.voice.status.preparingSpeech" : ""
    ].filter(Boolean).map(key => t(key)).join(" · ");
  });
  const heldTranscript = computed(() => pendingTranscript.value?.text ||
    (["listening", "transcribing"].includes(voice.captureState.value) ? voice.partialTranscript.value : ""));
  const voiceWords = computed(() => heldTranscript.value || binding.state.messages?.findLast(message => message.role === "user")?.text || "");
  const voiceAnswer = computed(() => binding.state.streamingReply?.text || binding.state.messages?.findLast(message => message.role === "assistant")?.text || "");
  let recording = null;
  let disposed = false;
  const narrationPageVisible = ref(pageVisible());
  const hiddenNarrationPage = computed(() => Boolean(binding.narration) && !narrationPageVisible.value);
  const replies = useVoiceReplies({
    binding,
    voice,
    readAloud,
    error,
    starting,
    capturing,
    speechActive,
    narrationPageVisible,
    hiddenNarrationPage,
    closed: () => disposed
  });

  /** The destination the application gives a new recording; a binding without captureContext gives none. */
  function readCaptureContext() {
    // readable-check: allow optional-call - optional operation: a binding may leave out captureContext, and its recordings then keep no destination
    return binding.captureContext?.() || {};
  }
  watch(() => binding.defaults?.readAloud, (value) => {
    if (disposed || typeof value !== "boolean" || value === readAloud.value) return;
    readAloud.value = value;
    void replies.applyReadAloud();
  });
  async function deliverTranscript() {
    const pending = pendingTranscript.value;
    if (!pending || sending.value) return;
    sending.value = true;
    error.value = "";
    try {
      replies.inviteSpeech(pending.messageId);
      const receipt = await binding.submitText(pending.text, { messageId: pending.messageId, context: pending.focus });
      if (receipt === false || receipt?.ok === false) {
        throw new Error(serverMessage(receipt || {}, t("jskit.assistant.voice.errors.notAccepted")));
      }
      if (pendingTranscript.value === pending) dismissTranscript();
    } catch (cause) { if (pendingTranscript.value === pending) error.value = voiceErrorText(cause); }
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
    } catch (cause) { recording = null; error.value = voiceErrorText(cause); }
  }
  async function startRecording(reviewBeforeSend, continuous = false) {
    if (disposed || hiddenNarrationPage.value || starting.value || microphoneMuted.value || capturing.value || committing ||
        (pendingTranscript.value || sending.value) && !(continuous && live.value && (callMode.value === "hands-free" || pushHolding.value))) return;
    error.value = "";
    reviewBeforeSend ||= binding.defaults?.reviewBeforeSend === true;
    heldReview.value = reviewBeforeSend;
    holding.value = reviewBeforeSend;
    // Keep the starting target even if navigation changes during this utterance.
    const next = { focus: { ...readCaptureContext() }, messageId: crypto.randomUUID(), started: false, reviewBeforeSend, continuous };
    recording = next;
    try {
      const started = await voice.startListening({ continuous });
      if (recording === next) { next.started = started; if (!started) recording = null; }
    } catch (cause) { if (recording === next) { recording = null; error.value = voiceErrorText(cause); } }
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
    } catch (cause) { await cancelRecording(); error.value = voiceErrorText(cause); }
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
      if (readAloud.value) void replies.enableSound();
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
        error.value = signal.aborted ? t("jskit.assistant.voice.errors.setupTimeout") : voiceErrorText(cause);
      }
    } finally {
      if (startupAbort === controller) { startupAbort = null; starting.value = false; }
    }
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
    const captured = { focus: { ...(recording?.focus || readCaptureContext()) }, messageId: recording?.messageId || crypto.randomUUID(), text: candidate.text,
      ...(recording?.reviewBeforeSend ? { reviewBeforeSend: true } : {}) };
    try {
      const text = candidate.text.trim();
      const spoken = replies.currentSpokenText();
      if (explicitSilence(text)) {
        if (!spoken.toLowerCase().includes(text.toLowerCase())) replies.stopSpeech();
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
        error.value = t("jskit.assistant.voice.errors.finishAndReview", { message: voiceErrorText(cause) });
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
    recording = { focus: { ...readCaptureContext() }, messageId: crypto.randomUUID(), started: true, continuous: true,
      ...(recording.reviewBeforeSend ? { reviewBeforeSend: true } : {}),
      ...(recording.finishAfterPending ? { finishAfterPending: true } : {}) };
  });
  watch(voice.partialTranscript, (text, previous) => {
    clearTimeout(stopTimer);
    if (!live.value || microphoneMuted.value) return;
    if (text && !previous && recording) recording.focus = { ...readCaptureContext() };
    if (!explicitSilence(text) || replies.currentSpokenText().toLowerCase().includes(text.toLowerCase())) return;
    stopTimer = setTimeout(() => {
      if (live.value && !microphoneMuted.value && voice.partialTranscript.value === text) replies.stopSpeech();
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
      void voice.stopListening().catch(cause => { error.value = voiceErrorText(cause); });
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
        error.value = t("jskit.assistant.voice.errors.microphoneNotReady");
      }
    } catch (cause) { await cancelRecording(); error.value = voiceErrorText(cause); }
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
        error.value = t("jskit.assistant.voice.errors.recordingInterrupted");
      }
      return;
    }
    const text = voice.transcript.value.trim();
    if (!text) {
      if (!finished.continuous) error.value = t("jskit.assistant.voice.errors.noSpeech");
      return;
    }
    if (live.value && !finished.reviewBeforeSend && explicitSilence(text)) {
      replies.stopSpeech();
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
    replies.observeHistory(messages, reply);
  }, { immediate: true });
  watch(replies.narrationSettings, replies.applyNarrationSettings, { immediate: true, deep: true });
  watch(voice.error, (message) => { if (message) replies.cancelSpeech("playback-error", "failed"); });
  // readable-check: allow optional-call - optional operation: a binding may leave out onError, and its errors then show only in the voice view
  watch(() => error.value || voice.error.value, (message) => { if (message) binding.onError?.(message); });
  watch([voice.activeSpeechTurnId, voice.canAppendSpeech], () => { void replies.drainSpeech(); });
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
    // readable-check: allow optional-call - optional operation: a binding may leave out onTranscript, or its getter may return none, and it is then not shown unsent words
    binding.onTranscript?.(transcript, { canTake: Boolean(transcript && canTakeTranscript(transcript.id)) });
  }
  watch([pendingTranscript, voice.captureState, voice.partialTranscript, voice.endpoint, sending, starting, takingTranscript], publishTranscript, { immediate: true });
  // readable-check: allow optional-call - optional operation: a binding may leave out onVisual, and then draws no avatar of its own
  watch(avatarVisual, (visual) => binding.onVisual?.(visual), { immediate: true });
  const updateNarrationVisibility = () => {
    narrationPageVisible.value = pageVisible();
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
  const stopVisibilityListener = listenToDocument("visibilitychange", updateNarrationVisibility);
  const cancelStartup = () => { if (starting.value) void discardRecording(); else void cancelPushToTalk(); };
  const stopPageHideListener = listenToPage("pagehide", cancelStartup);
  const stopBlurListener = listenToPage("blur", cancelPushToTalk);
  onScopeDispose(() => {
    stopVisibilityListener();
    stopPageHideListener();
    stopBlurListener();
    startupAbort?.abort(); startupAbort = null;
    replies.stopSpeech();
    // readable-check: allow optional-call - optional operation: a binding may leave out onTranscript, and is then not told the words are gone
    binding.onTranscript?.(null);
    // readable-check: allow optional-call - optional operation: a binding may leave out onVisual, and is then not told the avatar is gone
    binding.onVisual?.(null);
    disposed = true; live.value = false; clearTimeout(stopTimer); recording = null;
  });

  async function close() {
    startupAbort?.abort();
    disposed = true;
    live.value = false;
    clearTimeout(stopTimer);
    recording = null;
    committing = null;
    replies.stopSpeech();
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
    targetLabel, voice, readAloud, readAloudChangePending: replies.readAloudChangePending, error, pendingTranscript, heldReview, holding, sending,
    live, starting, callMode, changingCallMode, pushHolding, microphoneMuted, capturing,
    speechActive, callConnection, callStatus, callModeBusy,
    avatarVisual, callAudioLevel, status, heldTranscript, voiceWords, voiceAnswer,
    stopSpeech: replies.stopSpeech, inviteSpeech: replies.inviteSpeech, toggleReadAloud: replies.toggleReadAloud,
    enableSound: replies.enableSound, soundPreparing: replies.soundPreparing, deliverTranscript, cancelRecording,
    discardRecording, dismissTranscript, talk, toggleMicrophoneMuted, changeCallMode,
    startPushToTalk, finishPushToTalk, cancelPushToTalk, toggleLive, toggleHandsFree, startHeldRecording,
    finishHeldRecording, discardHeldRecording, close, editTranscript, canTakeTranscript, beginTranscriptEdit, takeTranscript, hasUnsentSpeech, composerBlocked
  };
}
