import { computed, ref, watch } from "vue";

import {
  VOICE_DEFAULT_SYNTHESIS_TIMEOUT_MS,
  VOICE_MAX_SYNTHESIS_TIMEOUT_MS,
  VOICE_OUTPUT_SAMPLE_RATE,
  speechTextFromAssistant
} from "../shared/protocol.js";
import { audioContextConstructor, createVoiceTurnId } from "./browser.js";
import { voiceError, voiceErrorText, voiceSpeechWording } from "./i18n.js";
import {
  normalizeSpeechSegment,
  pcm16ArrayBufferToFloat32,
  visemeCueAtTime
} from "./voicePlayback.js";

// readable-check: allow module-state - shared resource: the page has one speaker, so a second transport waits until the first stops speaking
const speechOwner = ref(null);

/**
 * The assistant's speech for one voice transport: it requests synthesis over the transport's connection, plays the
 * streamed PCM through Web Audio with viseme timing and a mouth meter, and reports when each turn's playback starts
 * and ends.
 * @param {{
 *   connect: () => Promise<boolean>,
 *   sendControl: (payload: object) => void,
 *   isConnected: () => boolean,
 *   enabled: import("vue").ComputedRef<boolean>,
 *   selectedVoice: import("vue").Ref<string>,
 *   onPlayback: (event: import("./types.js").VoicePlaybackEvent) => unknown,
 *   fail: (message: string) => void
 * }} dependencies
 */
function useVoiceSpeech({ connect, sendControl, isConnected, enabled, selectedVoice, onPlayback, fail }) {
  const speechState = ref("idle");
  const playbackBlocked = ref(false);
  const mouthLevel = ref(0);
  const mouthPose = ref("closed");
  const bufferedSeconds = ref(0);
  const synthesisPending = ref(0);
  const activeSpeechTurnId = ref("");
  const speechInputEnded = ref(true);
  let lastSpeechProgressAt = 0;
  let synthesisTimeoutMs = VOICE_DEFAULT_SYNTHESIS_TIMEOUT_MS;
  let lastStartedSegmentIndex = -1;
  const speechClaim = Symbol("voice playback");
  let closed = false;
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
  let speechSampleRate = VOICE_OUTPUT_SAMPLE_RATE;
  let receivingTurnId = "";
  let receivingSegment = null;
  let stopAfterSegment = Infinity;
  const streamedSegments = new Map();
  let pendingVisemeSegments = [];
  let scheduledVisemeSegments = [];
  const playbackSources = new Set();

  const speaking = computed(() => speechState.value === "speaking");
  const canAppendSpeech = computed(() => Boolean(activeSpeechTurnId.value) && !speechInputEnded.value &&
    synthesisPending.value < 2 && bufferedSeconds.value < 4);

  function emitPlayback(phase, reason) {
    const receipt = playbackReceipt;
    if (!receipt || receipt.terminal || (phase === "started" && receipt.started)) return;
    if (phase === "started") receipt.started = true;
    else receipt.terminal = true;
    try {
      Promise.resolve(onPlayback({
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
    const AudioContextCtor = audioContextConstructor();
    if (!AudioContextCtor) {
      playbackBlocked.value = true;
      throw voiceError("jskit.assistant.voice.errors.playbackUnsupported");
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
    playbackGain.gain.value = enabled.value ? 1 : 0;
    const context = playbackContext;
    const preparation = ++playbackPreparation;
    try {
      const resumed = context.resume();
      if (preparation === playbackPreparation && context.state !== "running") playbackBlocked.value = true;
      await resumed;
      if (context.state !== "running") throw voiceError("jskit.assistant.voice.errors.soundBlocked");
      if (preparation === playbackPreparation && !closed) playbackBlocked.value = false;
    } catch (cause) {
      // A newer unlock of this same context supersedes an older resume failure.
      if (preparation !== playbackPreparation && context === playbackContext &&
        context.state === "running" && !closed) return;
      if (preparation === playbackPreparation && !closed) playbackBlocked.value = true;
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
    // readable-check: allow fixed-result-shape - platform object: an AudioBufferSourceNode reports its end through onended
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
        if (epoch === playbackEpoch) fail(voiceErrorText(playbackError));
      })
      .finally(() => {
        if (epoch !== playbackEpoch) return;
        queuedPlaybackFrames -= 1;
        finishPlaybackWhenDrained();
      });
  }

  /**
   * Stops the current turn's audio and forgets its stream, reporting the receipt's outcome.
   * @param {string} [phase]
   * @param {string} [reason]
   */
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
    synthesisTimeoutMs = VOICE_DEFAULT_SYNTHESIS_TIMEOUT_MS;
    lastStartedSegmentIndex = -1;
    receivingTurnId = "";
    receivingSegment = null;
    streamedSegments.clear();
    pendingVisemeSegments = [];
    scheduledVisemeSegments = [];
    stopMouthMeter();
  }

  /**
   * Handles one `speech.*` control message from the voice service.
   * @param {string} type
   * @param {Record<string, any>} message
   */
  function receiveControl(type, message) {
    if (type === "speech.start") {
      receivingTurnId = String(message.turnId || "");
      receivingSegment = null;
      if (!message.turnId || message.turnId !== activeSpeechTurnId.value) {
        return;
      }
      speechSampleRate = Number(message.sampleRate) || VOICE_OUTPUT_SAMPLE_RATE;
      speechStreamEnded = false;
      speechState.value = "thinking";
      nextPlaybackTime = 0;
      return;
    }
    if (type === "speech.segment.start" && message.turnId === activeSpeechTurnId.value) {
      if (!speechStreamEnded && Number.isSafeInteger(message.segmentIndex) &&
          message.segmentIndex > lastStartedSegmentIndex) {
        lastStartedSegmentIndex = message.segmentIndex;
        synthesisTimeoutMs = VOICE_DEFAULT_SYNTHESIS_TIMEOUT_MS;
        if (Number.isSafeInteger(message.synthesisTimeoutMs) && message.synthesisTimeoutMs > VOICE_DEFAULT_SYNTHESIS_TIMEOUT_MS &&
            message.synthesisTimeoutMs <= VOICE_MAX_SYNTHESIS_TIMEOUT_MS) {
          // The engine acquired its queue slot. Allow its bounded cold job until
          // first PCM; repeated metadata and pongs are not synthesis progress.
          synthesisTimeoutMs = message.synthesisTimeoutMs;
          lastSpeechProgressAt = Date.now();
        }
      }
      receivingSegment = { index: message.segmentIndex };
      streamedSegments.set(message.segmentIndex, receivingSegment);
      return;
    }
    if (type === "speech.chunk.end" && message.turnId === activeSpeechTurnId.value) {
      synthesisTimeoutMs = VOICE_DEFAULT_SYNTHESIS_TIMEOUT_MS;
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
    }
  }

  /**
   * Queues one binary PCM frame from the voice service when it belongs to the turn being spoken.
   * @param {ArrayBuffer} buffer
   */
  function receiveAudio(buffer) {
    if (enabled.value && activeSpeechTurnId.value && receivingTurnId === activeSpeechTurnId.value && !speechStreamEnded) {
      synthesisTimeoutMs = VOICE_DEFAULT_SYNTHESIS_TIMEOUT_MS;
      lastSpeechProgressAt = Date.now();
      enqueuePcm(buffer);
    }
  }

  /**
   * Whether the voice service has made no synthesis progress on the current turn for longer than it allows.
   * @returns {boolean}
   */
  function stalled() {
    return Boolean(activeSpeechTurnId.value && synthesisPending.value && Date.now() - lastSpeechProgressAt > synthesisTimeoutMs);
  }

  async function speak(text, turnId = createVoiceTurnId("speak"), { stream = false } = {}) {
    const speechText = speechTextFromAssistant(text, undefined, voiceSpeechWording());
    if (closed || !enabled.value || !speechText) {
      return false;
    }
    if (activeSpeechTurnId.value && isConnected()) {
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
    const speechText = speechTextFromAssistant(text, undefined, voiceSpeechWording());
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

  /**
   * Lets the phrase playing now finish and drops the rest of the turn.
   * @returns {boolean} False when no phrase is under way, so the caller stops speaking instead.
   */
  function finishAfterCurrentPhrase() {
    emitPlayback("interrupted", "cancelled");
    const now = playbackContext?.currentTime || 0;
    const current = [...playbackSources].find(source => source.voiceEndsAt > now);
    if (!current?.voiceSegment) return false;
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
    return true;
  }

  /** Stops speaking for good and closes the audio context; nothing more is spoken. */
  function dispose() {
    closed = true;
    stopPlayback();
    void playbackContext?.close().catch(() => null);
    playbackContext = null;
  }

  watch(enabled, (on) => {
    if (playbackGain) {
      playbackGain.gain.value = on ? 1 : 0;
    }
  }, { flush: "sync" });

  return {
    activeSpeechTurnId,
    appendSpeech,
    bufferedSeconds,
    canAppendSpeech,
    dispose,
    endSpeech,
    finishAfterCurrentPhrase,
    mouthLevel,
    mouthPose,
    playbackBlocked,
    preparePlayback,
    receiveAudio,
    receiveControl,
    speak,
    speaking,
    speechState,
    stalled,
    stopPlayback
  };
}

export { useVoiceSpeech };
