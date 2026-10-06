import { computed, onScopeDispose, ref, watch } from "vue";
import { useVoiceTransport } from "./voiceTransport.js";
import { takeStreamingSpeech } from "../shared/protocol.js";

/** Created inside the controller's effect scope, independent of a mounted screen. */
export function useVoiceConversation(binding, { socketUrl, createTransport = useVoiceTransport } = {}) {
  const oneOffTalkMode = computed(() => binding.defaults?.talkMode === "hold" ? "hold" : "tap");
  const targetLabel = computed(() => binding.label || "Assistant");
  const readAloud = ref(false);
  const error = ref("");
  const pendingTranscript = ref(null);
  const heldReview = ref(false);
  const holding = ref(false);
  const sending = ref(false);
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
    autoReconnect: true
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
    || Boolean(voice.partialTranscript.value.trim()) || capturing.value && !voice.listening.value);
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

  function stopSpeech() {
    for (const reply of speechQueue) reply.cancelled = true;
    speechQueue.length = 0;
    speechSuppressed = true;
    speechInvitation = "";
    voice.stopSpeaking();
  }
  function inviteSpeech(messageId) {
    // Only a new request from this page can lift silence. A delayed admission,
    // history refresh or retry of the same request is not a new invitation.
    if (!messageId || messageId === requestedMessageId || seen.has(messageId)) return;
    requestedMessageId = messageId;
    speechInvitation = messageId;
  }
  async function drainSpeech() {
    if (draining || disposed || !readAloud.value || speechSuppressed) return;
    draining = true;
    try {
      while (speechQueue.length) {
        const reply = speechQueue[0];
        if (reply.cancelled) { speechQueue.shift(); continue; }
        if (reply.started && !speechActive.value) { speechQueue.shift(); continue; }
        if (speechActive.value && !reply.started) return;
        if (reply.started && !voice.canAppendSpeech.value) return;
        const chunk = takeStreamingSpeech(reply.raw.slice(reply.consumed), reply.final, reply.started ? 140 : 64);
        if (!chunk) {
          if (reply.final && reply.started) voice.endSpeech();
          else if (reply.final) { speechQueue.shift(); continue; }
          return;
        }
        reply.consumed += chunk.consumed;
        if (!chunk.text) continue;
        if (!reply.started) {
          reply.started = true;
          await voice.speak(chunk.text, crypto.randomUUID(), { stream: true });
          if (reply.cancelled || disposed) return;
        } else if (!voice.appendSpeech(chunk.text)) return;
        if (reply.final && reply.consumed >= reply.raw.length) { voice.endSpeech(); return; }
      }
    } catch (cause) { error.value = cause.message; stopSpeech(); }
    finally { draining = false; }
  }
  function queueReply(message, final) {
    let reply = replies.get(message.id);
    if (!reply) {
      if (!primed || !readAloud.value || speechSuppressed || seen.has(message.id) || (!final && message.autonomous)) return;
      reply = { id: message.id, streamId: message.streamId, raw: "", consumed: 0, final: false, started: false };
      replies.set(message.id, reply);
      speechQueue.push(reply);
    }
    if (reply.cancelled) return;
    const text = String(message.text || "").slice(0, 4000);
    const spokenPrefix = reply.raw.slice(0, reply.consumed);
    if (!text.startsWith(spokenPrefix) && !(final && text.trimEnd() === spokenPrefix.trimEnd())) {
      // A model revision cannot unsay words. Retire that projection; never splice
      // its old prefix onto a different answer or replay it as a second answer.
      reply.cancelled = true;
      if (speechQueue[0] === reply) voice.stopSpeaking();
      return;
    }
    reply.consumed = Math.min(reply.consumed, text.length);
    reply.raw = text;
    reply.final = final || text.length >= 4000;
  }
  async function enableSpeech() {
    speechSuppressed = false;
    speechInvitation = "";
    await voice.preparePlayback();
    readAloud.value = true;
  }
  async function toggleReadAloud() {
    error.value = "";
    if (readAloud.value) { readAloud.value = false; stopSpeech(); return; }
    try { await enableSpeech(); }
    catch (cause) { error.value = cause.message; }
  }
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
    pendingTranscript.value = null;
    heldReview.value = false;
    holding.value = false;
    error.value = "";
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
    if (disposed || starting.value || microphoneMuted.value || capturing.value || pendingTranscript.value || sending.value) return;
    error.value = "";
    reviewBeforeSend ||= binding.defaults?.reviewBeforeSend === true;
    heldReview.value = reviewBeforeSend;
    holding.value = reviewBeforeSend;
    // Keep the starting target even if navigation changes during this utterance.
    const next = { focus: { ...(binding.captureContext?.() || {}) }, messageId: crypto.randomUUID(), started: false, reviewBeforeSend, continuous };
    recording = next;
    if (!reviewBeforeSend && !live.value) {
      readAloud.value = true;
      void voice.preparePlayback().catch((cause) => { error.value = cause.message; });
    }
    try {
      const started = await voice.startListening({ continuous });
      if (recording === next) { next.started = started; if (!started) recording = null; }
    } catch (cause) { if (recording === next) { recording = null; error.value = cause.message; } }
  }
  async function toggleMicrophoneMuted() {
    voice.setMicrophoneMuted(!microphoneMuted.value);
    clearTimeout(stopTimer);
    if (microphoneMuted.value && starting.value) await cancelRecording();
    else if (!microphoneMuted.value && live.value && callMode.value === "hands-free" && !capturing.value && !pendingTranscript.value && !sending.value) await startRecording(false, true);
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
    if (event?.repeat || event?.isPrimary === false || event?.button !== undefined && event.button !== 0 || pushHolding.value || disposed || starting.value
      || capturing.value && !voice.listening.value || pendingTranscript.value || sending.value || committing) return;
    if (event?.pointerId !== undefined) event.currentTarget.setPointerCapture(event.pointerId);
    pushInput = event?.pointerId ?? event?.key ?? null;
    pushHolding.value = true;
    callMode.value = "push-to-talk";
    voice.setMicrophoneMuted(false);
    retireAnswer(true);
    if (!live.value) await toggleLive();
    if (!pushHolding.value || !live.value || disposed) return;
    // A hold can take over an open hands-free microphone without throwing away
    // its current words. Release then finalizes that same recording once.
    if (recording && voice.listening.value) {
      recording.continuous = false;
      return;
    }
    await startRecording(false);
    if (!recording) pushHolding.value = false;
  }
  async function finishPushToTalk(event) {
    if (!pushHolding.value || event && (event.pointerId ?? event.key ?? null) !== pushInput) return;
    pushHolding.value = false;
    pushInput = null;
    try {
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
    if (disposed || pushHolding.value || pendingTranscript.value || sending.value || committing) return;
    if (starting.value) { await cancelRecording(); return; }
    if (capturing.value && !voice.listening.value) return;
    if (live.value && callMode.value === "hands-free") {
      if (!microphoneMuted.value && voice.listening.value) {
        // Pause is an explicit utterance boundary. Flush before muting so the
        // final sound is included; resuming starts a fresh recording.
        await voice.stopListening();
        voice.setMicrophoneMuted(true);
      } else await toggleMicrophoneMuted();
      return;
    }
    if (callModeBusy.value) return;
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
      stopSpeech();
      readAloud.value = false;
      void voice.close().catch(cause => { if (!live.value) error.value = cause.message; });
      return;
    }
    if (disposed || microphoneMuted.value || capturing.value || pendingTranscript.value || sending.value) return;
    const controller = new AbortController();
    startupAbort = controller;
    starting.value = true;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    try {
      // Unlock playback in the click gesture. Live capture uses the same model
      // admission as typed chat and does not need a separate Helper connection.
      await voice.preparePlayback();
      signal.throwIfAborted();
      await voice.connect();
      signal.throwIfAborted();
      if (disposed) return;
      starting.value = false;
      live.value = true;
      readAloud.value = true;
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
  function retireAnswer(smooth = false) {
    for (const reply of speechQueue) reply.cancelled = true;
    speechQueue.length = 0;
    if (smooth) voice.finishCurrentPhrase();
    else voice.stopSpeaking();
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
    if (!live.value || callMode.value !== "hands-free" || !voice.listening.value || microphoneMuted.value || pendingTranscript.value || sending.value || !candidate) return;
    const key = `${candidate.turnId}:${candidate.revision}`;
    if (decidedCandidate === key) return;
    decidedCandidate = key;
    const captured = { focus: { ...(recording?.focus || (binding.captureContext?.() || {})) }, messageId: recording?.messageId || crypto.randomUUID(), text: candidate.text };
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
      // The daemon rechecks the endpoint revision before returning final text.
      // Continue the current phrase while the ordinary request steers the conversation.
      retireAnswer(true);
    } catch (cause) {
      if (live.value && candidate === voice.endpoint.value) {
        live.value = false;
        if (recording) recording.reviewBeforeSend = true;
        error.value = `${cause.message} Tap the microphone to finish and review this recording.`;
      }
    }
  }
  watch([voice.endpoint, pendingTranscript, sending], decideTurn);
  watch(voice.completedUtterance, (utterance) => {
    if (!utterance || !live.value || !committing || committing.turnId !== utterance.turnId || committing.revision !== utterance.revision) return;
    pendingTranscript.value = { ...committing, text: utterance.text };
    committing = null;
    void deliverTranscript();
  });
  watch(voice.utteranceReset, (reset) => {
    // A discard can lose a race with resumed speech. Keep this utterance's
    // identity and destination until the daemon acknowledges the boundary.
    if (reset?.turnId !== voice.activeListenTurnId.value || !live.value || !recording) return;
    recording = { focus: { ...(binding.captureContext?.() || {}) }, messageId: crypto.randomUUID(), started: true, continuous: true };
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
  watch([pendingTranscript, sending], () => {
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
    if (pendingTranscript.value && messages.some((message) => message.role === "user" && message.id === pendingTranscript.value.messageId)) {
      dismissTranscript();
    }
    for (const message of messages) {
      if (seen.has(message.id)) continue;
      if (message.role === "user" && message.id === speechInvitation) {
        speechSuppressed = false;
        speechInvitation = "";
      }
      if (message.role === "assistant") queueReply(message, true);
      seen.add(message.id);
    }
    if (lastStreamingId && lastStreamingId !== reply?.id && !messages.some(message => message.id === lastStreamingId)) {
      const retired = replies.get(lastStreamingId);
      if (retired && !retired.final && !retired.cancelled) {
        retired.cancelled = true;
        if (speechQueue[0] === retired) voice.finishCurrentPhrase();
      }
    }
    lastStreamingId = reply?.id || "";
    if (reply?.text) {
      queueReply(reply, reply.status === "completed");
      if (!readAloud.value || !primed || reply.autonomous) seen.add(reply.id);
    }
    // Keep only the visible history plus active playback receipts in memory.
    const retained = new Set([...messages.map((message) => message.id), reply?.id, ...speechQueue.map((item) => item.id)]);
    for (const id of seen) if (!retained.has(id)) seen.delete(id);
    for (const id of replies.keys()) if (!retained.has(id)) replies.delete(id);
    primed = true;
    void drainSpeech();
  }, { immediate: true });
  watch(voice.error, (message) => { if (message) stopSpeech(); });
  watch(() => error.value || voice.error.value, (message) => { if (message) binding.onError?.(message); });
  watch([voice.activeSpeechTurnId, voice.canAppendSpeech], () => { void drainSpeech(); });
  watch([pendingTranscript, voice.captureState, voice.partialTranscript], () => {
    const pending = pendingTranscript.value;
    const transcript = pending ? { id: pending.messageId, text: pending.text }
      : recording && ["listening", "transcribing"].includes(voice.captureState.value) && voice.partialTranscript.value
        ? { id: recording.messageId, text: voice.partialTranscript.value } : null;
    binding.onTranscript?.(transcript);
  }, { immediate: true });
  watch(avatarVisual, (visual) => binding.onVisual?.(visual), { immediate: true });
  const page = globalThis.window || globalThis;
  const cancelStartup = () => { if (starting.value) void discardRecording(); else void cancelPushToTalk(); };
  page.addEventListener?.("pagehide", cancelStartup);
  page.addEventListener?.("blur", cancelPushToTalk);
  onScopeDispose(() => {
    page.removeEventListener?.("pagehide", cancelStartup);
    page.removeEventListener?.("blur", cancelPushToTalk);
    startupAbort?.abort(); startupAbort = null;
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
  function editTranscript(text) {
    if (pendingTranscript.value && !sending.value) pendingTranscript.value = { ...pendingTranscript.value, text: String(text) };
  }
  const hasUnsentSpeech = computed(() => capturing.value || starting.value || sending.value || Boolean(pendingTranscript.value));
  return {
    oneOffTalkMode, targetLabel, voice, readAloud, error, pendingTranscript, heldReview, holding, sending,
    live, starting, callMode, changingCallMode, pushHolding, microphoneMuted, capturing,
    speechActive, talkLabel, liveLabel, callConnection, callStatus, callDetail, callModeBusy,
    microphoneStatus, avatarVisual, callAudioLevel, status, heldTranscript, voiceWords, voiceAnswer,
    stopSpeech, inviteSpeech, toggleReadAloud, deliverTranscript, cancelRecording,
    discardRecording, dismissTranscript, talk, toggleMicrophoneMuted, changeCallMode,
    startPushToTalk, finishPushToTalk, cancelPushToTalk, toggleLive, toggleHandsFree, startHeldRecording,
    finishHeldRecording, discardHeldRecording, close, editTranscript, hasUnsentSpeech
  };
}
