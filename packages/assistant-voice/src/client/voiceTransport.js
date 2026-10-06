import { computed, onScopeDispose, ref, watch } from "vue";

import { speechTextFromAssistant } from "../shared/protocol.js";
import { createMicrophoneCapture } from "./audioCapture.js";
import {
  normalizeSpeechSegment,
  pcm16ArrayBufferToFloat32,
  visemeCueAtTime
} from "./voicePlayback.js";

const INPUT_SAMPLE_RATE = 16_000;
const WEBSOCKET_OPEN = 1;
let microphoneOwner = null;
const speechOwner = ref(null);

function voiceTurnId(prefix = "turn") {
  const id = globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function resolveWebSocketUrl(value) {
  const url = new URL(value, globalThis.location?.href);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError("Voice requires a ws:// or wss:// endpoint without embedded credentials.");
  }
  return url.toString();
}

function useVoiceTransport({ socketUrl, speechEnabled = true, interruptSpeechOnListen = false, autoReconnect = false, voiceId = "", onPlayback } = {}) {
  const availableVoices = ref([]);
  const selectedVoice = ref(voiceId);
  const connectionState = ref("idle");
  const captureState = ref("idle");
  const speechState = ref("idle");
  const error = ref("");
  const playbackBlocked = ref(false);
  const transcript = ref("");
  const endpoint = ref(null);
  const completedUtterance = ref(null);
  const utteranceReset = ref(null);
  const partialTranscript = ref("");
  const muted = ref(false);
  const microphoneMuted = ref(false);
  const inputLevel = ref(0);
  const mouthLevel = ref(0);
  const mouthPose = ref("closed");
  const ready = ref(false);
  const reconnecting = ref(false);
  const bufferedSeconds = ref(0);
  const synthesisPending = ref(0);
  const activeListenTurnId = ref("");
  const activeSpeechTurnId = ref("");
  let socket = null;
  let connectedSocketPath = "";
  let connectPromise = null;
  let recoveryTimer;
  let recoveryAttempt = 0;
  let recoveryWanted = false;
  let heartbeatTimer;
  let lastPongAt = 0;
  let lastSpeechProgressAt = 0;
  let microphone = null;
  const openingMicrophones = new Set();
  let microphoneClaim = null;
  const speechClaim = Symbol("voice playback");
  let pendingListenTurnId = "";
  let unmounted = false;
  let playbackContext = null;
  let playbackGain = null;
  let playbackAnalyser = null;
  let playbackFrame = 0;
  let playbackPreparation = 0;
  let nextPlaybackTime = 0;
  let playbackEpoch = 0;
  let playbackReceipt = null;
  let playbackQueue = Promise.resolve();
  let queuedPlaybackFrames = 0;
  let speechStreamEnded = false;
  let speechSampleRate = 22_050;
  let receivingTurnId = "";
  let receivingSegment = null;
  const speechInputEnded = ref(true);
  let stopAfterSegment = Infinity;
  const streamedSegments = new Map();
  let pendingVisemeSegments = [];
  let scheduledVisemeSegments = [];
  const playbackSources = new Set();

  const speechOutputEnabled = computed(() => {
    const enabled = typeof speechEnabled === "function"
      ? speechEnabled()
      : speechEnabled?.value ?? speechEnabled;
    return enabled !== false && !muted.value;
  });
  const selectedSocketPath = computed(() => typeof socketUrl === "function" ? socketUrl() : socketUrl?.value || socketUrl || "");
  const state = computed(() => error.value ? "error" : captureState.value !== "idle" ? captureState.value
    : speechState.value !== "idle" ? speechState.value : connectionState.value);
  const listening = computed(() => captureState.value === "listening");
  const speaking = computed(() => speechState.value === "speaking");
  const busy = computed(() => captureState.value !== "idle" || connectionState.value === "connecting" || speechState.value === "thinking");

  const canAppendSpeech = computed(() => Boolean(activeSpeechTurnId.value) && !speechInputEnded.value &&
    synthesisPending.value < 2 && bufferedSeconds.value < 4);

  function emitPlayback(phase, reason) {
    const receipt = playbackReceipt;
    if (!receipt || receipt.terminal || (phase === "started" && receipt.started)) return;
    if (phase === "started") receipt.started = true;
    else receipt.terminal = true;
    try {
      Promise.resolve(onPlayback?.({
        turnId: receipt.turnId, phase, ...(reason ? { reason } : {})
      })).catch(() => {});
    } catch {
      // Observers cannot take ownership of playback or cleanup.
    }
  }

  function observePlaybackStart(source) {
    if (!source.voiceCancelled && playbackContext.state === "running" &&
      playbackContext.currentTime >= source.voiceStartsAt) emitPlayback("started");
  }

  function setError(message = "", reason = "playback-error") {
    pendingListenTurnId = "";
    endpoint.value = null;
    activeListenTurnId.value = "";
    void closeMicrophone().catch(() => null);
    stopPlayback("failed", reason);
    error.value = String(message || "Voice could not continue.");
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
      ? "Voice connection was interrupted. Your unfinished recording needs review; use Talk to resume."
      : "Voice connection was interrupted. The answer remains in chat; use Talk to resume.";
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
    if (activeSpeechTurnId.value && synthesisPending.value && Date.now() - lastSpeechProgressAt > 20000) {
      connectionLost("Speech generation stalled. The answer remains in chat; use Talk to resume.");
      return;
    }
    if (socket?.readyState === WEBSOCKET_OPEN) sendControl({ type: "ping", turnId: "heartbeat" });
  }

  function sendControl(payload) {
    if (socket?.readyState !== WEBSOCKET_OPEN) {
      throw new Error("Voice is not connected.");
    }
    socket.send(JSON.stringify(payload));
  }

  async function closeMicrophone() {
    const current = microphone;
    const claim = microphoneClaim;
    microphone = null;
    inputLevel.value = 0;
    try { await current?.close?.(); }
    finally { if (microphoneOwner === claim) microphoneOwner = null; }
  }

  function stopMouthMeter() {
    if (playbackFrame) {
      cancelAnimationFrame(playbackFrame);
      playbackFrame = 0;
    }
    mouthLevel.value = 0;
    mouthPose.value = "closed";
  }

  function startMouthMeter() {
    if (playbackFrame || !playbackAnalyser) {
      return;
    }
    const samples = new Float32Array(playbackAnalyser.fftSize);
    const spectrum = new Uint8Array(playbackAnalyser.frequencyBinCount);
    const averageBand = (fromHz, toHz) => {
      const binWidth = playbackContext.sampleRate / playbackAnalyser.fftSize;
      const start = Math.max(0, Math.floor(fromHz / binWidth));
      const end = Math.min(spectrum.length, Math.ceil(toHz / binWidth));
      let total = 0;
      for (let index = start; index < end; index += 1) {
        total += spectrum[index];
      }
      return total / Math.max(1, end - start);
    };
    const update = () => {
      for (const source of playbackSources) observePlaybackStart(source);
      bufferedSeconds.value = Math.max(0, nextPlaybackTime - playbackContext.currentTime);
      playbackAnalyser.getFloatTimeDomainData(samples);
      playbackAnalyser.getByteFrequencyData(spectrum);
      let sum = 0;
      for (const sample of samples) {
        sum += sample * sample;
      }
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 7);
      scheduledVisemeSegments = scheduledVisemeSegments.filter((segment) => (
        playbackContext.currentTime <= segment.startedAt + (segment.durationMs / 1_000) + 0.5
      ));
      const viseme = visemeCueAtTime(scheduledVisemeSegments, playbackContext.currentTime);
      mouthLevel.value = viseme
        ? Math.max(level, viseme.level)
        : level;
      if (viseme?.pose === "closed" || (!viseme && level < 0.035)) {
        mouthPose.value = "closed";
      } else if (viseme) {
        mouthPose.value = viseme.pose;
      } else {
        const low = averageBand(120, 700);
        const middle = averageBand(700, 2_100);
        const high = averageBand(2_100, 4_800);
        if (level > 0.63) {
          mouthPose.value = "open";
        } else if (low > (middle + high) * 0.72) {
          mouthPose.value = "round";
        } else if (middle + high > low * 1.55) {
          mouthPose.value = "wide";
        } else {
          mouthPose.value = "small";
        }
      }
      if (speaking.value || playbackSources.size) {
        playbackFrame = requestAnimationFrame(update);
      } else {
        stopMouthMeter();
      }
    };
    playbackFrame = requestAnimationFrame(update);
  }

  async function preparePlayback() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      playbackBlocked.value = true;
      throw new Error("This browser does not support streamed audio playback.");
    }
    if (!playbackContext || playbackContext.state === "closed") {
      playbackContext = new AudioContextCtor({ latencyHint: "interactive" });
      playbackGain = playbackContext.createGain();
      playbackAnalyser = playbackContext.createAnalyser();
      playbackAnalyser.fftSize = 1_024;
      playbackAnalyser.smoothingTimeConstant = 0.58;
      playbackGain.connect(playbackAnalyser);
      playbackAnalyser.connect(playbackContext.destination);
    }
    playbackGain.gain.value = speechOutputEnabled.value ? 1 : 0;
    const context = playbackContext;
    const preparation = ++playbackPreparation;
    try {
      const resumed = context.resume();
      if (preparation === playbackPreparation && context.state !== "running") playbackBlocked.value = true;
      await resumed;
      if (context.state !== "running") throw new Error("Sound is blocked by this browser.");
      if (preparation === playbackPreparation && !unmounted) playbackBlocked.value = false;
    } catch (cause) {
      // A newer unlock of this same context supersedes an older resume failure.
      if (preparation !== playbackPreparation && context === playbackContext &&
        context.state === "running" && !unmounted) return;
      if (preparation === playbackPreparation && !unmounted) playbackBlocked.value = true;
      throw cause;
    }
  }

  function finishPlaybackWhenDrained() {
    if (!activeSpeechTurnId.value || !speechStreamEnded || playbackSources.size || queuedPlaybackFrames) {
      return;
    }
    if (playbackReceipt?.started) emitPlayback("completed");
    else emitPlayback("failed", "playback-error");
    activeSpeechTurnId.value = "";
    speechState.value = "idle";
    if (speechOwner.value === speechClaim) speechOwner.value = null;
    stopMouthMeter();
  }

  function claimVisemeTiming(sampleCount, startsAt) {
    let remaining = sampleCount;
    let offsetSamples = 0;
    while (remaining > 0 && pendingVisemeSegments.length) {
      const segment = pendingVisemeSegments[0];
      if (!Number.isFinite(segment.startedAt)) {
        segment.startedAt = startsAt + (offsetSamples / speechSampleRate);
        scheduledVisemeSegments.push(segment);
      }
      const consumed = Math.min(remaining, segment.remainingSamples);
      segment.remainingSamples -= consumed;
      remaining -= consumed;
      offsetSamples += consumed;
      if (segment.remainingSamples <= 0) {
        pendingVisemeSegments.shift();
      }
    }
  }

  async function schedulePcm(buffer, epoch = playbackEpoch, segment = null) {
    if (epoch !== playbackEpoch || (segment && segment.index > stopAfterSegment)) return;
    await preparePlayback();
    if (epoch !== playbackEpoch) {
      return;
    }
    if (segment && segment.index > stopAfterSegment) return;
    const samples = pcm16ArrayBufferToFloat32(buffer);
    if (!samples.length) {
      return;
    }
    const audioBuffer = playbackContext.createBuffer(1, samples.length, speechSampleRate);
    audioBuffer.copyToChannel(samples, 0);
    const source = playbackContext.createBufferSource();
    source.buffer = audioBuffer;
    source.voiceSegment = segment;
    source.connect(playbackGain);
    const startsAt = Math.max(playbackContext.currentTime + 0.025, nextPlaybackTime);
    nextPlaybackTime = startsAt + audioBuffer.duration;
    source.voiceStartsAt = startsAt;
    source.voiceEndsAt = nextPlaybackTime;
    if (segment) {
      if (!Number.isFinite(segment.startedAt)) {
        segment.startedAt = startsAt;
        if (segment.metadata) scheduledVisemeSegments.push({ ...segment.metadata, startedAt: startsAt });
      }
    } else claimVisemeTiming(samples.length, startsAt);
    bufferedSeconds.value = Math.max(0, nextPlaybackTime - playbackContext.currentTime);
    playbackSources.add(source);
    speechState.value = "speaking";
    source.onended = () => {
      source.disconnect();
      if (epoch !== playbackEpoch) return;
      // A natural end also observes very short sounds between animation frames.
      if (!source.voiceCancelled && playbackContext.state === "running") emitPlayback("started");
      playbackSources.delete(source);
      bufferedSeconds.value = playbackSources.size ? Math.max(0, nextPlaybackTime - playbackContext.currentTime) : 0;
      if (!playbackSources.size) speechState.value = "thinking";
      finishPlaybackWhenDrained();
    };
    source.start(startsAt);
    startMouthMeter();
  }

  function enqueuePcm(buffer) {
    const epoch = playbackEpoch;
    const segment = receivingSegment;
    queuedPlaybackFrames += 1;
    playbackQueue = playbackQueue
      .then(() => schedulePcm(buffer, epoch, segment))
      .catch((playbackError) => {
        if (epoch === playbackEpoch) setError(playbackError?.message || playbackError);
      })
      .finally(() => {
        if (epoch !== playbackEpoch) return;
        queuedPlaybackFrames -= 1;
        finishPlaybackWhenDrained();
      });
  }

  function stopPlayback(phase = "interrupted", reason = "cancelled") {
    emitPlayback(phase, reason);
    playbackEpoch += 1;
    activeSpeechTurnId.value = "";
    speechState.value = "idle";
    if (speechOwner.value === speechClaim) speechOwner.value = null;
    // Retired continuations keep their old epoch, not ownership of this queue.
    playbackQueue = Promise.resolve();
    queuedPlaybackFrames = 0;
    for (const source of playbackSources) {
      try {
        source.voiceCancelled = true;
        source.stop();
      } catch {
        // A source that already ended needs no further cleanup.
      }
    }
    playbackSources.clear();
    nextPlaybackTime = 0;
    speechStreamEnded = true;
    speechInputEnded.value = true;
    stopAfterSegment = Infinity;
    bufferedSeconds.value = 0;
    synthesisPending.value = 0;
    receivingTurnId = "";
    receivingSegment = null;
    streamedSegments.clear();
    pendingVisemeSegments = [];
    scheduledVisemeSegments = [];
    stopMouthMeter();
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
    if (type === "speech.start") {
      receivingTurnId = String(message.turnId || "");
      receivingSegment = null;
      if (!message.turnId || message.turnId !== activeSpeechTurnId.value) {
        return;
      }
      speechSampleRate = Number(message.sampleRate) || 22_050;
      speechStreamEnded = false;
      speechState.value = "thinking";
      nextPlaybackTime = 0;
      return;
    }
    if (type === "speech.segment.start" && message.turnId === activeSpeechTurnId.value) {
      receivingSegment = { index: message.segmentIndex };
      streamedSegments.set(message.segmentIndex, receivingSegment);
      return;
    }
    if (type === "speech.chunk.end" && message.turnId === activeSpeechTurnId.value) {
      lastSpeechProgressAt = Date.now();
      synthesisPending.value = Math.max(0, synthesisPending.value - 1);
      return;
    }
    if (type === "speech.segment" && message.turnId === activeSpeechTurnId.value && !speechStreamEnded) {
      const segment = normalizeSpeechSegment(message, speechSampleRate);
      const streamed = streamedSegments.get(message.segmentIndex);
      if (streamed) {
        streamed.metadata = segment;
        if (Number.isFinite(streamed.startedAt)) scheduledVisemeSegments.push({ ...segment, startedAt: streamed.startedAt });
        streamedSegments.delete(message.segmentIndex);
      } else if (segment.sampleCount) pendingVisemeSegments.push(segment);
      return;
    }
    if (type === "speech.end" && message.turnId === activeSpeechTurnId.value) {
      speechStreamEnded = true;
      finishPlaybackWhenDrained();
      return;
    }
    if (type === "busy" || type === "error") {
      const turnId = String(message.turnId || "");
      if (turnId && turnId !== activeListenTurnId.value && turnId !== activeSpeechTurnId.value) {
        return;
      }
      setError(String(message.message || (type === "busy"
        ? "Voice is busy. Try again shortly."
        : "Voice service could not continue.")));
    }
  }

  function handleSocketMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      if (speechOutputEnabled.value && activeSpeechTurnId.value && receivingTurnId === activeSpeechTurnId.value && !speechStreamEnded) {
        lastSpeechProgressAt = Date.now();
        enqueuePcm(event.data);
      }
      return;
    }
    let message;
    try {
      message = JSON.parse(String(event.data || ""));
    } catch {
      setError("Voice service sent an invalid response.");
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
    current?.close?.(1000, "Voice client closed");
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
      throw new Error("Voice requires an available conversation.");
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
        reject(new Error("Voice service took too long to connect."));
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
          else reject(new Error(message.message || "Voice could not connect. Try again."));
        } catch {
          // The regular message handler will surface malformed responses.
        }
      };
      nextSocket.addEventListener("message", onReady);
      nextSocket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Voice service could not be reached."));
      }, { once: true });
      nextSocket.addEventListener("close", () => {
        clearTimeout(timeout);
        reject(new Error("Voice service closed while connecting."));
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
        if (!recovery) setError(connectionError?.message || connectionError);
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
      error.value = "Finish the recording in the other conversation before starting this microphone.";
      return false;
    }
    microphoneClaim = Symbol("voice microphone");
    microphoneOwner = microphoneClaim;
    const turnId = voiceTurnId("listen");
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
            if (!microphoneMuted.value && socket?.readyState === WEBSOCKET_OPEN && activeListenTurnId.value === turnId) {
              if (socket.bufferedAmount > 32 * 1024) {
                connectionLost("The microphone connection fell behind. Review the unfinished recording before sending.");
                return;
              }
              socket.send(frame);
            }
          },
          targetSampleRate: INPUT_SAMPLE_RATE
        });
        openingMicrophones.add(opening);
        try { capture = await opening; }
        finally { openingMicrophones.delete(opening); }
      } catch (microphoneError) {
        if (pendingListenTurnId !== turnId) return false;
        const denied = ["NotAllowedError", "PermissionDeniedError"].includes(microphoneError?.name);
        setError(denied
          ? "Microphone access was denied. Allow it in your browser to talk to the assistant."
          : "The microphone could not be opened on this device.");
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
        sendControl({ sampleRate: INPUT_SAMPLE_RATE, turnId, type: "listen.start", ...(continuous ? { continuous: true } : {}) });
        captureState.value = "listening";
      } catch (controlError) {
        activeListenTurnId.value = "";
        await closeMicrophone();
        throw controlError;
      }
      return true;
    } catch (startError) {
      if (pendingListenTurnId !== turnId) return false;
      setError(startError?.message || startError);
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

  async function speak(text, turnId = voiceTurnId("speak"), { stream = false } = {}) {
    const speechText = speechTextFromAssistant(text);
    if (unmounted || !speechOutputEnabled.value || !speechText) {
      return false;
    }
    if (activeSpeechTurnId.value && socket?.readyState === WEBSOCKET_OPEN) {
      sendControl({ turnId: activeSpeechTurnId.value, type: "cancel" });
    }
    stopPlayback();
    const epoch = playbackEpoch;
    playbackReceipt = { turnId, started: false, terminal: false };
    activeSpeechTurnId.value = turnId;
    speechState.value = "thinking";
    try {
      await preparePlayback();
      if (epoch !== playbackEpoch) return false;
      await connect();
      if (epoch !== playbackEpoch) return false;
      if (speechOwner.value) {
        await new Promise((resolve) => {
          const unwatch = watch([speechOwner, activeSpeechTurnId], () => {
            if (epoch !== playbackEpoch || !speechOwner.value) {
              if (epoch === playbackEpoch) speechOwner.value = speechClaim;
              unwatch();
              resolve();
            }
          }, { flush: "sync" });
        });
      } else speechOwner.value = speechClaim;
      if (epoch !== playbackEpoch) return false;
      speechState.value = "thinking";
      speechInputEnded.value = !stream;
      synthesisPending.value = 1;
      lastSpeechProgressAt = Date.now();
      sendControl({ text: speechText, turnId, type: "speak.start", ...(stream ? { stream: true } : {}), ...(selectedVoice.value ? { voiceId: selectedVoice.value } : {}) });
      return true;
    } catch (speechError) {
      if (epoch !== playbackEpoch) return false;
      stopPlayback("failed", "playback-error");
      speechState.value = "idle";
      throw speechError;
    }
  }

  function appendSpeech(text) {
    if (!canAppendSpeech.value) return false;
    const speechText = speechTextFromAssistant(text);
    if (!speechText) return false;
    if (!synthesisPending.value) lastSpeechProgressAt = Date.now();
    synthesisPending.value += 1;
    sendControl({ text: speechText, turnId: activeSpeechTurnId.value, type: "speak.append" });
    return true;
  }

  function endSpeech() {
    if (!activeSpeechTurnId.value || speechInputEnded.value) return;
    speechInputEnded.value = true;
    sendControl({ turnId: activeSpeechTurnId.value, type: "speak.end" });
  }

  function finishCurrentPhrase() {
    if (!activeSpeechTurnId.value) return;
    emitPlayback("interrupted", "cancelled");
    const now = playbackContext?.currentTime || 0;
    const current = [...playbackSources].find(source => source.voiceEndsAt > now);
    if (!current?.voiceSegment) { stopSpeaking(); return; }
    stopAfterSegment = current.voiceSegment.index;
    speechInputEnded.value = true;
    for (const source of [...playbackSources]) {
      if (source.voiceSegment?.index <= stopAfterSegment) continue;
      source.voiceCancelled = true;
      source.stop();
      playbackSources.delete(source);
    }
    nextPlaybackTime = Math.max(now, ...[...playbackSources].map(source => source.voiceEndsAt));
    bufferedSeconds.value = Math.max(0, nextPlaybackTime - now);
    sendControl({ type: "speak.stop-after", turnId: activeSpeechTurnId.value, segmentIndex: stopAfterSegment });
  }

  function stopSpeaking(reason = "cancelled") {
    const turnId = activeSpeechTurnId.value;
    const pending = turnId && !ready.value && !activeListenTurnId.value && !pendingListenTurnId;
    stopPlayback("interrupted", reason);
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

  function setMicrophoneMuted(value) {
    microphoneMuted.value = Boolean(value);
    microphone?.setMuted(microphoneMuted.value);
    if (microphoneMuted.value) inputLevel.value = 0;
  }

  watch(speechOutputEnabled, (enabled) => {
    if (playbackGain) {
      playbackGain.gain.value = enabled ? 1 : 0;
    }
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
      setError("Voice paused when this page was suspended. Review any unfinished words and use Talk to resume.");
    }
    recoveryWanted = false;
    reconnecting.value = false;
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
    disconnect({ preserveError: true });
  }
  const page = globalThis.window || globalThis;
  page.addEventListener?.("pagehide", pauseForPageExit);
  onScopeDispose(() => {
    page.removeEventListener?.("pagehide", pauseForPageExit);
    unmounted = true;
    clearTimeout(recoveryTimer);
    clearInterval(heartbeatTimer);
    pendingListenTurnId = "";
    activeListenTurnId.value = "";
    void closeMicrophone().catch(() => null);
    stopPlayback();
    disconnect();
    void playbackContext?.close?.().catch(() => null);
    playbackContext = null;
  });

  return {
    availableVoices,
    selectedVoice,
    activeListenTurnId,
    activeSpeechTurnId,
    appendSpeech,
    bufferedSeconds,
    canAppendSpeech,
    endSpeech,
    captureState,
    completedUtterance,
    utteranceReset,
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
    mouthLevel,
    mouthPose,
    microphoneMuted,
    muted,
    partialTranscript,
    playbackBlocked,
    preparePlayback,
    ready,
    reconnecting,
    speak,
    speaking,
    startListening,
    setMicrophoneMuted,
    state,
    stopListening,
    stopSpeaking,
    toggleMuted,
    transcript
  };
}

export {
  useVoiceTransport,
  voiceTurnId
};
