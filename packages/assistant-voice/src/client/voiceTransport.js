import { computed, onScopeDispose, ref, toValue, watch } from "vue";

import { VOICE_INPUT_SAMPLE_RATE } from "../shared/protocol.js";
import { createMicrophoneCapture } from "./audioCapture.js";
import { createVoiceTurnId, listenToPage } from "./browser.js";
import { useJskitText, voiceError, voiceErrorText, voiceEventError } from "./i18n.js";
import { useVoiceSpeech } from "./voiceSpeech.js";

const WEBSOCKET_OPEN = 1;
// readable-check: allow module-state - shared resource: the page has one microphone, so one transport holds it at a time
let microphoneOwner = null;

/** Receives no playback receipts. */
function ignorePlayback() {}

function resolveWebSocketUrl(value) {
  const url = new URL(value, globalThis.location?.href);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError("Voice requires a ws:// or wss:// endpoint without embedded credentials.");
  }
  return url.toString();
}

/**
 * One duplex connection to the voice service: the socket with its heartbeat and recovery, the microphone and its
 * transcripts, and the assistant's speech, which voiceSpeech.js plays.
 * @param {{
 *   socketUrl: import("vue").MaybeRefOrGetter<string>,
 *   speechEnabled?: import("vue").MaybeRefOrGetter<boolean>,
 *   interruptSpeechOnListen?: boolean,
 *   autoReconnect?: boolean,
 *   voiceId?: string,
 *   onPlayback?: (event: import("./types.js").VoicePlaybackEvent) => unknown
 * }} options
 */
function useVoiceTransport({ socketUrl, speechEnabled = true, interruptSpeechOnListen = false, autoReconnect = false, voiceId = "", onPlayback = ignorePlayback }) {
  const { serverMessage, t } = useJskitText();
  const availableVoices = ref([]);
  const selectedVoice = ref(voiceId);
  const connectionState = ref("idle");
  const captureState = ref("idle");
  const error = ref("");
  const transcript = ref("");
  const endpoint = ref(null);
  const completedUtterance = ref(null);
  const utteranceReset = ref(null);
  const utteranceStale = ref(null);
  const partialTranscript = ref("");
  const muted = ref(false);
  const microphoneMuted = ref(false);
  const inputLevel = ref(0);
  const ready = ref(false);
  const reconnecting = ref(false);
  const activeListenTurnId = ref("");
  let socket = null;
  let connectedSocketPath = "";
  let connectPromise = null;
  let recoveryTimer;
  let recoveryAttempt = 0;
  let recoveryWanted = false;
  let heartbeatTimer;
  let lastPongAt = 0;
  let microphone = null;
  let preserveBufferedMicrophone = false;
  const openingMicrophones = new Set();
  let microphoneClaim = null;
  let pendingListenTurnId = "";
  let unmounted = false;

  const speechOutputEnabled = computed(() => toValue(speechEnabled) !== false && !muted.value);
  const selectedSocketPath = computed(() => toValue(socketUrl) || "");
  const speech = useVoiceSpeech({
    connect,
    sendControl,
    isConnected: () => socket?.readyState === WEBSOCKET_OPEN,
    enabled: speechOutputEnabled,
    selectedVoice,
    onPlayback,
    fail: setError
  });
  const { activeSpeechTurnId, speechState } = speech;
  const state = computed(() => error.value ? "error" : captureState.value !== "idle" ? captureState.value
    : speechState.value !== "idle" ? speechState.value : connectionState.value);
  const listening = computed(() => captureState.value === "listening");
  const busy = computed(() => captureState.value !== "idle" || connectionState.value === "connecting" || speechState.value === "thinking");

  function setError(message = "", reason = "playback-error") {
    pendingListenTurnId = "";
    endpoint.value = null;
    activeListenTurnId.value = "";
    void closeMicrophone().catch(() => null);
    speech.stopPlayback("failed", reason);
    error.value = String(message || t("jskit.assistant.voice.errors.couldNotContinue"));
    captureState.value = "idle";
    connectionState.value = "idle";
  }

  function scheduleRecovery() {
    if (!autoReconnect || unmounted || !recoveryWanted || recoveryTimer) return;
    if (recoveryAttempt >= 5) { reconnecting.value = false; return; }
    reconnecting.value = true;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      recoveryAttempt += 1;
      void connect({ recovery: true }).catch(() => scheduleRecovery());
    }, Math.min(8000, 750 * 2 ** recoveryAttempt) + Math.floor(Math.random() * 250));
  }

  function connectionLost(message) {
    message ||= activeListenTurnId.value || pendingListenTurnId
      ? t("jskit.assistant.voice.errors.interruptedRecording")
      : t("jskit.assistant.voice.errors.interrupted");
    const wasActive = Boolean(activeListenTurnId.value || pendingListenTurnId || activeSpeechTurnId.value || reconnecting.value);
    setError(message, "disconnected");
    disconnect({ preserveError: true });
    recoveryWanted = autoReconnect && wasActive;
    scheduleRecovery();
  }

  function heartbeat() {
    if (!activeListenTurnId.value && !activeSpeechTurnId.value) { lastPongAt = Date.now(); return; }
    if (Date.now() - lastPongAt > 12000) {
      connectionLost();
      return;
    }
    if (speech.stalled()) {
      connectionLost(t("jskit.assistant.voice.errors.speechStalled"));
      return;
    }
    if (socket?.readyState === WEBSOCKET_OPEN) sendControl({ type: "ping", turnId: "heartbeat" });
  }

  function sendControl(payload) {
    if (socket?.readyState !== WEBSOCKET_OPEN) {
      throw voiceError("jskit.assistant.voice.errors.notConnected");
    }
    socket.send(JSON.stringify(payload));
  }

  async function closeMicrophone() {
    const current = microphone;
    const claim = microphoneClaim;
    microphone = null;
    inputLevel.value = 0;
    try { await current?.close(); }
    finally { if (microphoneOwner === claim) microphoneOwner = null; }
  }

  function handleControlMessage(message = {}) {
    const type = String(message.type || "");
    if (type === "pong") { lastPongAt = Date.now(); return; }
    if (type === "voice.ready") {
      availableVoices.value = Array.isArray(message.voices) ? message.voices : [];
      if (!availableVoices.value.some(voice => voice.id === selectedVoice.value)) selectedVoice.value = message.defaultVoice || "";
      lastPongAt = Date.now();
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(heartbeat, 4000);
      reconnecting.value = false;
      recoveryWanted = false;
      recoveryAttempt = 0;
      ready.value = true;
      error.value = "";
      connectionState.value = "idle";
      return;
    }
    if (type === "transcript.partial" && message.turnId === activeListenTurnId.value) {
      endpoint.value = null;
      partialTranscript.value = String(message.text || "");
      transcript.value = partialTranscript.value;
      return;
    }
    if (type === "transcript.endpoint" && message.turnId === activeListenTurnId.value) {
      endpoint.value = { turnId: message.turnId, revision: message.revision, text: String(message.text || "") };
      return;
    }
    if (["transcript.reset", "transcript.stale"].includes(type) && message.turnId === activeListenTurnId.value) {
      endpoint.value = null;
      if (type === "transcript.reset") {
        utteranceReset.value = { turnId: message.turnId, revision: message.revision };
        transcript.value = "";
        partialTranscript.value = "";
      } else {
        utteranceStale.value = { turnId: message.turnId, revision: message.revision };
      }
      return;
    }
    if (type === "transcript.final" && message.turnId === activeListenTurnId.value) {
      inputLevel.value = 0;
      transcript.value = String(message.text || "");
      partialTranscript.value = "";
      endpoint.value = null;
      if (message.continuous) {
        completedUtterance.value = { text: transcript.value, turnId: message.turnId, revision: message.revision };
      } else {
        activeListenTurnId.value = "";
        captureState.value = "idle";
      }
      return;
    }
    if (type.startsWith("speech.")) {
      speech.receiveControl(type, message);
      return;
    }
    if (type === "busy" || type === "error") {
      const turnId = String(message.turnId || "");
      if (turnId && turnId !== activeListenTurnId.value && turnId !== activeSpeechTurnId.value) {
        return;
      }
      setError(serverMessage(message, type === "busy"
        ? t("jskit.assistant.voice.errors.busy")
        : t("jskit.assistant.voice.errors.serviceCouldNotContinue")));
    }
  }

  function handleSocketMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      speech.receiveAudio(event.data);
      return;
    }
    let message;
    try {
      message = JSON.parse(String(event.data || ""));
    } catch {
      setError(t("jskit.assistant.voice.errors.invalidResponse"));
      return;
    }
    handleControlMessage(message);
  }

  function disconnect({ preserveError = false } = {}) {
    clearInterval(heartbeatTimer);
    const current = socket;
    socket = null;
    connectedSocketPath = "";
    connectPromise = null;
    ready.value = false;
    current?.close(1000, "Voice client closed");
    connectionState.value = "idle";
    if (!preserveError) error.value = "";
  }

  async function connect({ recovery = false } = {}) {
    if (!recovery) {
      clearTimeout(recoveryTimer); recoveryTimer = null;
      recoveryAttempt = 0; recoveryWanted = false; reconnecting.value = false;
    }
    const path = selectedSocketPath.value;
    if (!path) {
      throw voiceError("jskit.assistant.voice.errors.conversationRequired");
    }
    if (connectedSocketPath === path && socket?.readyState === WEBSOCKET_OPEN && ready.value) {
      return true;
    }
    if (connectedSocketPath === path && connectPromise) {
      return connectPromise;
    }
    disconnect({ preserveError: recovery });
    connectionState.value = "connecting";
    if (!recovery) error.value = "";
    ready.value = false;
    connectedSocketPath = path;
    const nextSocket = new WebSocket(resolveWebSocketUrl(path));
    socket = nextSocket;
    nextSocket.binaryType = "arraybuffer";
    connectPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(voiceError("jskit.assistant.voice.errors.connectTimeout"));
        nextSocket.close();
      }, 8_000);
      const onReady = (event) => {
        if (event.data instanceof ArrayBuffer) {
          return;
        }
        try {
          const message = JSON.parse(String(event.data || ""));
          if (!["voice.ready", "error", "busy"].includes(message.type)) {
            return;
          }
          clearTimeout(timeout);
          nextSocket.removeEventListener("message", onReady);
          if (message.type === "voice.ready") resolve(true);
          else reject(voiceEventError(message, "jskit.assistant.voice.errors.couldNotConnect"));
        } catch {
          // The regular message handler will surface malformed responses.
        }
      };
      nextSocket.addEventListener("message", onReady);
      nextSocket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(voiceError("jskit.assistant.voice.errors.unreachable"));
      }, { once: true });
      nextSocket.addEventListener("close", () => {
        clearTimeout(timeout);
        reject(voiceError("jskit.assistant.voice.errors.closedWhileConnecting"));
      }, { once: true });
    });
    nextSocket.addEventListener("message", (event) => {
      if (socket === nextSocket) handleSocketMessage(event);
    });
    nextSocket.addEventListener("close", () => {
      if (socket !== nextSocket) {
        return;
      }
      socket = null;
      connectPromise = null;
      ready.value = false;
      clearInterval(heartbeatTimer);
      if (pendingListenTurnId || !["idle", "error"].includes(state.value)) {
        connectionLost();
      }
    });
    try {
      return await connectPromise;
    } catch (connectionError) {
      if (socket === nextSocket) {
        if (!recovery) setError(voiceErrorText(connectionError));
        disconnect({ preserveError: true });
      }
      throw connectionError;
    }
  }

  async function startListening({ continuous = false } = {}) {
    if (unmounted || pendingListenTurnId || activeListenTurnId.value) {
      return false;
    }
    if (microphoneOwner && microphoneOwner !== microphoneClaim) {
      error.value = t("jskit.assistant.voice.errors.microphoneInUse");
      return false;
    }
    microphoneClaim = Symbol("voice microphone");
    microphoneOwner = microphoneClaim;
    preserveBufferedMicrophone = false;
    const turnId = createVoiceTurnId("listen");
    pendingListenTurnId = turnId;
    if (interruptSpeechOnListen) stopSpeaking();
    captureState.value = "connecting";
    error.value = "";
    try {
      await connect();
      if (pendingListenTurnId !== turnId) return false;
      captureState.value = "opening";
      let capture;
      try {
        const opening = createMicrophoneCapture({
          onLevel(level) {
            if (activeListenTurnId.value === turnId && !microphoneMuted.value) {
              inputLevel.value = Number(level) || 0;
            }
          },
          onPcm(frame) {
            if ((!microphoneMuted.value || preserveBufferedMicrophone) && socket?.readyState === WEBSOCKET_OPEN && activeListenTurnId.value === turnId) {
              if (socket.bufferedAmount > 32 * 1024) {
                connectionLost(t("jskit.assistant.voice.errors.microphoneBehind"));
                return;
              }
              socket.send(frame);
            }
          },
          targetSampleRate: VOICE_INPUT_SAMPLE_RATE
        });
        openingMicrophones.add(opening);
        try { capture = await opening; }
        finally { openingMicrophones.delete(opening); }
      } catch (microphoneError) {
        if (pendingListenTurnId !== turnId) return false;
        const denied = ["NotAllowedError", "PermissionDeniedError"].includes(microphoneError?.name);
        setError(denied
          ? t("jskit.assistant.voice.errors.microphoneDenied")
          : t("jskit.assistant.voice.errors.microphoneUnavailable"));
        return false;
      }
      if (pendingListenTurnId !== turnId) {
        await capture.close();
        return false;
      }
      microphone = capture;
      microphone.setMuted(microphoneMuted.value);
      activeListenTurnId.value = turnId;
      transcript.value = "";
      partialTranscript.value = "";
      try {
        endpoint.value = null;
        completedUtterance.value = null;
        sendControl({ sampleRate: VOICE_INPUT_SAMPLE_RATE, turnId, type: "listen.start", ...(continuous ? { continuous: true } : {}) });
        captureState.value = "listening";
      } catch (controlError) {
        activeListenTurnId.value = "";
        await closeMicrophone();
        throw controlError;
      }
      return true;
    } catch (startError) {
      if (pendingListenTurnId !== turnId) return false;
      setError(voiceErrorText(startError));
      throw startError;
    } finally {
      if (pendingListenTurnId === turnId) pendingListenTurnId = "";
    }
  }

  function finishUtterance(candidate, { discard = false } = {}) {
    if (candidate !== endpoint.value || candidate?.turnId !== activeListenTurnId.value) return false;
    sendControl({ turnId: candidate.turnId, revision: candidate.revision, type: discard ? "listen.discard" : "listen.commit" });
    endpoint.value = null;
    return true;
  }

  async function stopListening() {
    if (!activeListenTurnId.value || !microphone) {
      return;
    }
    const turnId = activeListenTurnId.value;
    captureState.value = "transcribing";
    await closeMicrophone();
    if (activeListenTurnId.value !== turnId) return;
    sendControl({ turnId, type: "listen.stop" });
  }

  function finishCurrentPhrase() {
    if (!activeSpeechTurnId.value) return;
    if (!speech.finishAfterCurrentPhrase()) stopSpeaking();
  }

  function stopSpeaking(reason = "cancelled") {
    const turnId = activeSpeechTurnId.value;
    const pending = turnId && !ready.value && !activeListenTurnId.value && !pendingListenTurnId;
    speech.stopPlayback("interrupted", reason);
    if (turnId && socket?.readyState === WEBSOCKET_OPEN) sendControl({ turnId, type: "cancel" });
    if (pending) disconnect();
  }

  async function cancelListening() {
    const pending = pendingListenTurnId && !activeSpeechTurnId.value && !ready.value;
    pendingListenTurnId = "";
    const turnId = activeListenTurnId.value;
    endpoint.value = null;
    activeListenTurnId.value = "";
    captureState.value = "idle";
    partialTranscript.value = "";
    transcript.value = "";
    try {
      if (turnId && socket?.readyState === WEBSOCKET_OPEN) sendControl({ turnId, type: "cancel" });
    } finally {
      const closing = closeMicrophone();
      if (pending) disconnect();
      await closing;
    }
  }

  async function cancel() {
    const closing = cancelListening();
    stopSpeaking();
    await closing;
  }

  async function close() {
    recoveryWanted = false; reconnecting.value = false;
    clearTimeout(recoveryTimer); recoveryTimer = null;
    const closing = cancel();
    disconnect();
    // Browser permission prompts cannot be cancelled. A new target must wait
    // until any late grant has been closed, even though ordinary Cancel is fast.
    await Promise.all([
      closing,
      ...[...openingMicrophones].map(opening => opening.then(capture => capture.close(), () => {}))
    ]);
  }

  function toggleMuted() {
    muted.value = !muted.value;
  }

  function setMicrophoneMuted(value, { preserveBuffered = false } = {}) {
    microphoneMuted.value = Boolean(value);
    preserveBufferedMicrophone = microphoneMuted.value && preserveBuffered;
    microphone?.setMuted(microphoneMuted.value, { preserveBuffered });
    if (microphoneMuted.value) inputLevel.value = 0;
  }

  watch(speechOutputEnabled, (enabled) => {
    if (!enabled && activeSpeechTurnId.value) {
      stopSpeaking("muted");
    }
  }, { flush: "sync" });
  watch(selectedSocketPath, () => {
    transcript.value = "";
    partialTranscript.value = "";
    void close().catch(() => null);
  }, { flush: "sync" });
  function pauseForPageExit() {
    if (activeListenTurnId.value || pendingListenTurnId || activeSpeechTurnId.value) {
      setError(t("jskit.assistant.voice.errors.pageSuspended"));
    }
    recoveryWanted = false;
    reconnecting.value = false;
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
    disconnect({ preserveError: true });
  }
  const stopPageExitListener = listenToPage("pagehide", pauseForPageExit);
  onScopeDispose(() => {
    stopPageExitListener();
    unmounted = true;
    clearTimeout(recoveryTimer);
    clearInterval(heartbeatTimer);
    pendingListenTurnId = "";
    activeListenTurnId.value = "";
    void closeMicrophone().catch(() => null);
    speech.dispose();
    disconnect();
  });

  return {
    availableVoices,
    selectedVoice,
    activeListenTurnId,
    activeSpeechTurnId,
    appendSpeech: speech.appendSpeech,
    bufferedSeconds: speech.bufferedSeconds,
    canAppendSpeech: speech.canAppendSpeech,
    endSpeech: speech.endSpeech,
    captureState,
    completedUtterance,
    utteranceReset,
    utteranceStale,
    endpoint,
    finishUtterance,
    finishCurrentPhrase,
    busy,
    cancel,
    cancelListening,
    close,
    connect,
    error,
    inputLevel,
    listening,
    mouthLevel: speech.mouthLevel,
    mouthPose: speech.mouthPose,
    microphoneMuted,
    muted,
    partialTranscript,
    playbackBlocked: speech.playbackBlocked,
    preparePlayback: speech.preparePlayback,
    ready,
    reconnecting,
    speak: speech.speak,
    speaking: speech.speaking,
    startListening,
    setMicrophoneMuted,
    state,
    stopListening,
    stopSpeaking,
    toggleMuted,
    transcript
  };
}

export { useVoiceTransport };
