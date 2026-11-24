import { readFileSync } from "node:fs";
import http from "node:http";

import { WebSocketServer } from "ws";

import {
  VOICE_CATALOGUE_PATH,
  VOICE_DAEMON_WEBSOCKET_PATH,
  VOICE_DEFAULT_SYNTHESIS_TIMEOUT_MS,
  VOICE_HEALTH_PATH,
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_MAX_AUDIO_FRAME_BYTES,
  VOICE_MAX_CONTROL_BYTES,
  VOICE_MAX_UTTERANCE_SECONDS,
  VOICE_MAX_SYNTHESIS_TIMEOUT_MS,
  VOICE_PROTOCOL_VERSION,
  VOICE_VOICES_PATH,
  assertVoiceAudioFrame,
  parseVoiceClientControl,
  speechPauseDurationMs,
  splitSpeechText,
  voiceServerMessage
} from "../shared/protocol.js";
import { visemeCuesFromText } from "../shared/visemes.js";
import { bearerVoiceAccessToken, createVoiceCredentialStore } from "./voiceCredentials.js";
import { refuseUpgrade, requestPathname, writeJsonResponse } from "./voiceDaemonHttp.js";
import { createBoundedSpeechQueue } from "./voiceSpeechQueue.js";

const WEBSOCKET_OPEN = 1;
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

function sendJson(socket, type, fields = {}) {
  if (socket.readyState !== WEBSOCKET_OPEN) {
    return false;
  }
  socket.send(voiceServerMessage(type, fields));
  return true;
}

function sendPcm(socket, audio = Buffer.alloc(0)) {
  for (let offset = 0; offset < audio.byteLength; offset += VOICE_MAX_AUDIO_FRAME_BYTES) {
    if (socket.readyState !== WEBSOCKET_OPEN) {
      return false;
    }
    const end = Math.min(audio.byteLength, offset + VOICE_MAX_AUDIO_FRAME_BYTES);
    socket.send(audio.subarray(offset, end), { binary: true });
  }
  return true;
}

// An error event keeps its code and English message, and carries what a browser
// needs to show that sentence in the user's language.
function voiceDaemonError(error, fallback = { message: "Voice operation failed.", messageCode: "assistant.voice.daemon.operationFailed" }) {
  const source = error?.message || error ? error : fallback;
  return {
    code: String(error?.code || "voice_operation_failed"),
    message: String(error?.message || error || fallback.message),
    ...(source?.params ? { params: source.params } : {}),
    ...(source?.messageCode ? { messageCode: source.messageCode, messageParams: source.messageParams || {} } : {})
  };
}

/** A connection that has not started work has none to cancel. */
function nothingToCancel() {}

function poolSize(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

/** Writes each access record as one JSON line on standard output. */
function writeAccessLine(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/**
 * A speech engine's recognition of one recording. Each method may answer a
 * promise; the host runs one at a time per recording.
 * @typedef {object} VoiceRecognizer
 * @property {(frame: Buffer) => string | Promise<string>} acceptPcm Recognizes a slice of 16 kHz PCM and answers the words so far.
 * @property {() => string | Promise<string>} finish Ends the recording and answers its final words.
 * @property {() => string | Promise<string>} reset Starts the next utterance of a continuous recording and answers the last one's words.
 * @property {() => boolean | Promise<boolean>} isEndpoint Whether the speaker has paused at the end of an utterance.
 * @property {() => void} cancel Drops the recording.
 * @property {number} acceptedSamples The samples recognized so far.
 */

/**
 * The speech engine a voice host runs: its recognition, synthesis and voices.
 * @typedef {object} VoiceSpeechEngine
 * @property {(options: { continuous: boolean, onPartial: (text: string) => void, onEndpoint: (text: string) => void }) => VoiceRecognizer} createListeningSession
 * @property {(text: string, options: { onAudio: (frame: Uint8Array) => void, signal: AbortSignal, voiceId: string }) => Promise<{ sampleRate?: number }>} synthesize
 * @property {() => Promise<unknown>} warmup Loads the models before the host accepts connections.
 * @property {number} sampleRate
 * @property {number} [synthesisTimeoutMs] How long one phrase's synthesis may take, when longer than the protocol's default.
 * @property {{ id: string, label: string, language?: string }[]} [voices]
 * @property {string} [defaultVoice]
 * @property {{ id: string, language?: string, hotwords?: number, spellings?: number }[]} [recognitionModels]
 * @property {{ recognition?: number, synthesis?: number }} [concurrency] How many recognitions and syntheses it runs at once (default one each).
 * @property {Record<string, string>} [versions] Its packages and native runtime, by name.
 */

/**
 * What a voice host records about one connection: never its audio or words.
 * @typedef {object} VoiceAccessRecord
 * @property {"voice.connection"} type
 * @property {string | null} client The credentials file's client name, or null when the token named none.
 * @property {string} startedAt
 * @property {string} endedAt
 * @property {number} audioSecondsHeard Seconds of microphone audio received.
 * @property {number} charactersSpoken Characters of reply text given to synthesis.
 * @property {"client" | "idle" | "revoked" | "shutdown" | "protocol" | "error" | "unauthorized" | "capacity"} closed
 * @property {number} [closeCode]
 */

/**
 * What a voice host records when it loads its credentials, at start and on each
 * change of the file; voice.credentials.refused names a file it could not use,
 * with the credentials still in use.
 * @typedef {object} VoiceCredentialsRecord
 * @property {"voice.credentials" | "voice.credentials.refused"} type
 * @property {string} at
 * @property {string | null} credentialsSha256 The SHA-256 of the file in use, or null when it is missing.
 * @property {number} [clients]
 * @property {string[]} [clientsAdded]
 * @property {string[]} [clientsRemoved]
 * @property {string[]} [clientsChanged] Clients whose tokens or limit changed.
 * @property {number} [sessionsEnded] Open sessions whose token the change removed.
 * @property {string} [reason]
 */

/**
 * A voice host: an HTTP server whose WebSocket connections recognize the speaker's
 * words and speak the answer, with the health and catalogue routes. Clients sign
 * in with a bearer token whose SHA-256 the host's credentials file lists.
 * @param {object} options
 * @param {string} options.credentialsFile
 * @param {number} [options.credentialsPollMs] How often the credentials file is checked for changes.
 * @param {(record: VoiceAccessRecord | VoiceCredentialsRecord) => void} [options.accessLog] Receives one record per connection and one per credentials load; by default a JSON line on standard output.
 * @param {VoiceSpeechEngine} options.engine
 * @param {string} [options.host]
 * @param {number} [options.idleTimeoutMs]
 * @param {{ warn: (fields: object, message: string) => void }} [options.logger]
 * @param {number} [options.maximumConnections] Default eight per recognition worker.
 * @param {number} [options.maximumConnectionsPerClient] Default two per recognition worker; a client's own maximumConnections replaces it.
 * @param {number} [options.maximumQueuedSpeech] Default four per synthesis worker.
 * @param {number} [options.port]
 */
function createVoiceDaemon({
  credentialsFile,
  credentialsPollMs = 1000,
  accessLog = writeAccessLine,
  engine,
  host = "127.0.0.1",
  idleTimeoutMs = 90_000,
  logger = console,
  maximumConnections,
  maximumConnectionsPerClient,
  maximumQueuedSpeech,
  port = 3092
}) {
  // readable-check: allow method-probe - input validation: an application hands over the speech engine its host runs
  if (!engine || typeof engine.createListeningSession !== "function" || typeof engine.synthesize !== "function" || typeof engine.warmup !== "function") {
    throw new TypeError("createVoiceDaemon requires a speech engine.");
  }
  const recognitionWorkers = poolSize(engine.concurrency?.recognition);
  const synthesisWorkers = poolSize(engine.concurrency?.synthesis);
  const totalLimit = maximumConnections ?? 8 * recognitionWorkers;
  const clientLimit = maximumConnectionsPerClient ?? 2 * recognitionWorkers;
  const clientConnections = new Map();
  const connections = new Map();
  const speechQueue = createBoundedSpeechQueue({
    concurrency: synthesisWorkers,
    maximumQueued: maximumQueuedSpeech ?? 4 * synthesisWorkers
  });
  const credentials = createVoiceCredentialStore({
    file: credentialsFile,
    pollIntervalMs: credentialsPollMs,
    onRefused(reason) {
      logAccess({ type: "voice.credentials.refused", at: new Date().toISOString(), reason, credentialsSha256: credentials.sha256 });
    },
    onChange(changes) {
      const sessionsEnded = endRevokedConnections();
      logAccess({ type: "voice.credentials", at: new Date().toISOString(), credentialsSha256: credentials.sha256, ...changes, sessionsEnded });
    }
  });
  let ready = false;
  let startedAt = "";
  let stopping = false;
  const versions = Object.freeze({ "@jskit-ai/assistant-voice": PACKAGE_VERSION, ...engine.versions });
  const voiceCatalogue = () => ({
    voices: (engine.voices || []).map(({ id, label, language }) => ({ id, label, ...(language ? { language } : {}) })),
    defaultVoice: engine.defaultVoice || ""
  });
  const serviceCatalogue = () => ({
    protocolVersion: VOICE_PROTOCOL_VERSION,
    inputSampleRate: VOICE_INPUT_SAMPLE_RATE,
    outputSampleRate: Number(engine.sampleRate),
    recognitionModels: (engine.recognitionModels || []).map(({ id, language, hotwords, spellings }) => ({
      id, ...(language ? { language } : {}), ...(Number.isSafeInteger(hotwords) ? { hotwords } : {}),
      ...(Number.isSafeInteger(spellings) ? { spellings } : {})
    })),
    ...voiceCatalogue()
  });

  function logAccess(record) {
    try {
      accessLog(Object.freeze({ type: "voice.connection", ...record }));
    } catch (error) {
      logger.warn({ error: String(error?.message || error) }, "Voice access log failed.");
    }
  }

  function logRefusal(client, closed) {
    const at = new Date().toISOString();
    logAccess({ client, startedAt: at, endedAt: at, audioSecondsHeard: 0, charactersSpoken: 0, closed });
  }

  const authenticatedRoutes = new Map([
    [VOICE_VOICES_PATH, voiceCatalogue],
    [VOICE_CATALOGUE_PATH, serviceCatalogue]
  ]);
  const server = http.createServer((request, response) => {
    const pathname = requestPathname(request);
    if (request.method === "GET" && pathname === VOICE_HEALTH_PATH) {
      writeJsonResponse(response, ready && !stopping ? 200 : 503, {
        connections: connections.size,
        ok: ready && !stopping,
        protocolVersion: VOICE_PROTOCOL_VERSION,
        queueDepth: speechQueue.depth,
        startedAt,
        versions,
        credentialsSha256: credentials.sha256
      });
      return;
    }
    const route = request.method === "GET" ? authenticatedRoutes.get(pathname) : null;
    if (!route) { writeJsonResponse(response, 404, { ok: false }); return; }
    if (!ready || stopping) { writeJsonResponse(response, 503, { ok: false }); return; }
    if (!credentials.principalFor(bearerVoiceAccessToken(request.headers))) { writeJsonResponse(response, 401, { ok: false }); return; }
    writeJsonResponse(response, 200, route());
  });
  const websocketServer = new WebSocketServer({
    maxPayload: Math.max(VOICE_MAX_AUDIO_FRAME_BYTES, VOICE_MAX_CONTROL_BYTES),
    noServer: true,
    perMessageDeflate: false
  });

  function connectionCapacityAvailable(principal) {
    return connections.size < totalLimit &&
      (clientConnections.get(principal.client) || 0) < (principal.maximumConnections ?? clientLimit);
  }

  function claimConnection(principal, socket) {
    connections.set(socket, {
      client: principal.client,
      tokenSha256: principal.tokenSha256,
      startedAt: new Date().toISOString(),
      heardBytes: 0,
      charactersSpoken: 0,
      closed: "client",
      cancel: nothingToCancel
    });
    clientConnections.set(principal.client, (clientConnections.get(principal.client) || 0) + 1);
  }

  function releaseConnection(socket, closeCode) {
    const connection = connections.get(socket);
    if (!connection) return;
    connections.delete(socket);
    const next = (clientConnections.get(connection.client) || 1) - 1;
    if (next) clientConnections.set(connection.client, next);
    else clientConnections.delete(connection.client);
    logAccess({
      client: connection.client,
      startedAt: connection.startedAt,
      endedAt: new Date().toISOString(),
      audioSecondsHeard: Math.round(connection.heardBytes / 2 / VOICE_INPUT_SAMPLE_RATE * 100) / 100,
      charactersSpoken: connection.charactersSpoken,
      closed: connection.closed,
      ...(Number.isInteger(closeCode) ? { closeCode } : {})
    });
  }

  function closeConnection(socket, reason, code, message) {
    const connection = connections.get(socket);
    if (connection && connection.closed === "client") connection.closed = reason;
    socket.close(code, message);
  }

  // A credential the host removed ends its open sessions at once, work and all,
  // and the connection is cut a second later if the peer does not answer the close.
  function endRevokedConnections() {
    let ended = 0;
    for (const [socket, connection] of connections) {
      if (connection.closed === "revoked" || credentials.accepts(connection.tokenSha256, connection.client)) continue;
      ended += 1;
      connection.cancel();
      sendJson(socket, "error", { code: "voice_access_revoked", message: "This application's voice access was revoked." });
      closeConnection(socket, "revoked", 1008, "Voice access was revoked");
      setTimeout(() => socket.terminate(), 1000).unref();
    }
    return ended;
  }

  websocketServer.on("connection", (socket, request, principal) => {
    claimConnection(principal, socket);
    const connection = connections.get(socket);
    let listening = null;
    let finishing = null;
    let speaking = null;
    let invalidMessages = 0;
    let lastActivity = Date.now();

    const cancelListening = () => {
      if (listening) listening.recognizer.cancel();
      listening = null;
    };
    const cancelSpeaking = () => {
      speaking?.controller?.abort();
      speaking = null;
    };
    const resetIdle = () => {
      lastActivity = Date.now();
    };
    const idleTimer = setInterval(() => {
      if (Date.now() - lastActivity < idleTimeoutMs || socket.readyState !== WEBSOCKET_OPEN) {
        return;
      }
      closeConnection(socket, "idle", 1000, "Voice connection idle");
    }, Math.min(idleTimeoutMs, 15_000));
    idleTimer.unref();

    const failMessage = (error) => {
      invalidMessages += 1;
      const publicError = voiceDaemonError(error);
      sendJson(socket, "error", publicError);
      if (invalidMessages >= 3) {
        closeConnection(socket, "protocol", 1008, "Invalid voice protocol messages");
      }
    };

    connection.cancel = () => {
      cancelListening();
      if (finishing) { finishing.cancelled = true; finishing.recognizer.cancel(); }
      cancelSpeaking();
    };

    const startListening = (control) => {
      cancelListening();
      const turnId = control.turnId;
      const recognizer = engine.createListeningSession({
        continuous: control.continuous === true,
        onPartial(text) {
          if (listening?.turnId === turnId) {
            listening.revision += 1;
            listening.candidateRevision = 0;
            sendJson(socket, "transcript.partial", { text, turnId, revision: listening.revision });
          }
        },
        onEndpoint(text) {
          if (listening?.turnId !== turnId || !listening.continuous) return;
          listening.candidateRevision = listening.revision;
          sendJson(socket, "transcript.endpoint", { text, turnId, revision: listening.revision });
        }
      });
      listening = { recognizer, turnId, revision: 0, candidateRevision: 0, continuous: control.continuous === true,
        pending: [], pendingBytes: 0, draining: false, ending: false, cancelled: false };
      sendJson(socket, "listen.started", { turnId });
    };

    const recognizeNext = async (active) => {
      const { frame, control } = active.pending.shift();
      if (frame) {
        active.pendingBytes -= frame.byteLength;
        if (active.recognizer.acceptedSamples + frame.byteLength / 2 > VOICE_INPUT_SAMPLE_RATE * VOICE_MAX_UTTERANCE_SECONDS) {
          throw Object.assign(new Error(`Voice recordings are limited to ${VOICE_MAX_UTTERANCE_SECONDS} seconds.`), {
            code: "voice_utterance_too_long", params: { seconds: VOICE_MAX_UTTERANCE_SECONDS }
          });
        }
        await active.recognizer.acceptPcm(frame);
      } else if (control.type === "listen.stop") {
        listening = null;
        finishing = active;
        try {
          const text = await active.recognizer.finish();
          if (!active.cancelled) sendJson(socket, "transcript.final", { text, turnId: active.turnId });
        } finally { if (finishing === active) finishing = null; }
      } else if (!active.continuous || active.candidateRevision !== control.revision || !(await active.recognizer.isEndpoint())) {
        sendJson(socket, "transcript.stale", { turnId: active.turnId, revision: control.revision });
      } else {
        const text = await active.recognizer.reset();
        if (listening !== active) return;
        active.candidateRevision = 0;
        active.revision += 1;
        if (control.type === "listen.commit") sendJson(socket, "transcript.final", {
          text, turnId: active.turnId, revision: control.revision, continuous: true
        });
        sendJson(socket, "transcript.reset", { turnId: active.turnId, revision: active.revision });
      }
    };

    // One recognition step at a time per recording, each after a turn of the
    // event loop, so a burst of microphone frames cannot starve PCM delivery or
    // controls, and a recording's steps keep their order.
    const drainListening = async (active) => {
      if (active.draining) return;
      active.draining = true;
      try {
        while (listening === active && active.pending.length) {
          await new Promise(resolve => setImmediate(resolve));
          if (listening !== active) return;
          try {
            await recognizeNext(active);
          } catch (error) {
            if (listening === active) cancelListening();
            else active.recognizer.cancel();
            if (!active.cancelled) failMessage(error);
            return;
          }
        }
      } finally { active.draining = false; }
    };

    const queueListening = (active, entry) => {
      const bytes = entry.frame?.byteLength || 0;
      // About two seconds of unrecognized input; a clipped instruction must
      // return to review instead of silently building a delayed conversation.
      if (active.pendingBytes + bytes > VOICE_MAX_AUDIO_FRAME_BYTES || active.pending.length >= 128) {
        cancelListening();
        throw Object.assign(new Error("Speech recognition fell behind. Your recording may be incomplete; review the recognized words."), {
          code: "voice_recognition_backpressure"
        });
      }
      active.pending.push(entry);
      active.pendingBytes += bytes;
      void drainListening(active);
    };

    const drainSpeech = async (active) => {
      if (active.processing || speaking !== active) return;
      active.processing = true;
      const { controller, turnId } = active;
      try {
        while (active.pending.length && !controller.signal.aborted) {
          const chunk = active.pending.shift();
          // Queue each phrase separately so another client can get a turn.
          const phrases = splitSpeechText(chunk);
          for (const [position, text] of phrases.entries()) {
            if (active.segmentIndex > active.stopAfter || controller.signal.aborted) break;
            if (!active.started && !text.trim()) continue;
            await speechQueue.run(async () => {
              if (controller.signal.aborted || socket.readyState !== WEBSOCKET_OPEN) return;
              if (!active.started) {
                active.started = true;
                sendJson(socket, "speech.start", { sampleRate: Number(engine.sampleRate), turnId });
              }
              const segmentIndex = active.segmentIndex++;
              const synthesisTimeoutMs = engine.synthesisTimeoutMs;
              sendJson(socket, "speech.segment.start", { segmentIndex, turnId,
                ...(Number.isSafeInteger(synthesisTimeoutMs) && synthesisTimeoutMs > VOICE_DEFAULT_SYNTHESIS_TIMEOUT_MS &&
                    synthesisTimeoutMs <= VOICE_MAX_SYNTHESIS_TIMEOUT_MS ? { synthesisTimeoutMs } : {}) });
              let sampleCount = 0;
              const words = text.trim();
              if (words) connection.charactersSpoken += [...words].length;
              const result = words ? await engine.synthesize(words, {
                onAudio(frame) {
                  if (controller.signal.aborted || socket.readyState !== WEBSOCKET_OPEN) return;
                  // Do not wait for the phrase's duration/visemes to start audio.
                  resetIdle();
                  sampleCount += frame.byteLength / 2;
                  if (socket.bufferedAmount > 512 * 1024) {
                    controller.abort();
                    sendJson(socket, "error", { turnId, code: "voice_playback_backpressure",
                      message: "Voice playback fell behind. Speech stopped; the answer remains in chat." });
                    return;
                  }
                  sendPcm(socket, Buffer.from(frame));
                },
                signal: controller.signal,
                voiceId: active.voiceId
              }) : { sampleRate: engine.sampleRate };
              if (controller.signal.aborted || socket.readyState !== WEBSOCKET_OPEN) return;
              const sampleRate = Number(result?.sampleRate || engine.sampleRate);
              const spokenDurationMs = Math.round(sampleCount / sampleRate * 1000);
              const last = active.ended && !active.pending.length && position === phrases.length - 1;
              const pauseSamples = last && !text.endsWith("\n") ? 0 : Math.round(speechPauseDurationMs(text) * sampleRate / 1000);
              if (pauseSamples) sendPcm(socket, Buffer.alloc(pauseSamples * 2));
              sampleCount += pauseSamples;
              sendJson(socket, "speech.segment", { cues: visemeCuesFromText(text, spokenDurationMs),
                durationMs: Math.round(sampleCount / sampleRate * 1000), sampleCount, segmentIndex, turnId });
            });
          }
          if (!controller.signal.aborted) sendJson(socket, "speech.chunk.end", { turnId });
        }
        if (active.ended && !controller.signal.aborted && socket.readyState === WEBSOCKET_OPEN) {
          sendJson(socket, "speech.end", { turnId });
          if (speaking === active) speaking = null;
        }
      } catch (error) {
        if (!controller.signal.aborted) sendJson(socket, error?.code === "voice_busy" ? "busy" : "error", {
          ...voiceDaemonError(error, { message: "Speech could not be generated.", messageCode: "assistant.voice.daemon.speechFailed" }), turnId
        });
        controller.abort();
        if (speaking === active) speaking = null;
      } finally { active.processing = false; }
    };

    const startSpeaking = (control) => {
      const voiceId = control.voiceId || engine.defaultVoice;
      if (voiceId && !engine.voices?.some(voice => voice.id === voiceId)) {
        throw Object.assign(new Error("This voice is unavailable. Choose another voice."), {
          code: "voice_selection_invalid", messageCode: "assistant.voice.daemon.voiceUnavailable", messageParams: {}
        });
      }
      cancelSpeaking();
      speaking = { controller: new AbortController(), turnId: control.turnId,
        voiceId, pending: [control.text], ended: !control.stream, processing: false, started: false, segmentIndex: 0, stopAfter: Infinity };
      void drainSpeech(speaking);
    };

    socket.on("message", (raw, isBinary) => {
      if (socket.readyState !== WEBSOCKET_OPEN) return;
      resetIdle();
      try {
        if (isBinary) {
          if (!listening || listening.ending) {
            throw Object.assign(new Error("Audio arrived without an active recording."), {
              code: "voice_listen_not_active", messageCode: "assistant.voice.daemon.audioWithoutRecording", messageParams: {}
            });
          }
          const frame = assertVoiceAudioFrame(raw);
          connection.heardBytes += frame.byteLength;
          const active = listening;
          const sliceBytes = VOICE_INPUT_SAMPLE_RATE / 10 * 2;
          for (let offset = 0; offset < frame.byteLength; offset += sliceBytes) {
            queueListening(active, { frame: frame.subarray(offset, offset + sliceBytes) });
          }
          invalidMessages = 0;
          return;
        }
        const control = parseVoiceClientControl(raw);
        if (control.type === "ping") {
          sendJson(socket, "pong", { turnId: control.turnId });
        } else if (control.type === "listen.start") {
          startListening(control);
        } else if (control.type === "listen.stop") {
          if (!listening || listening.ending || listening.turnId !== control.turnId) {
            throw Object.assign(new Error("No matching voice recording is active."), {
              code: "voice_listen_not_active", messageCode: "assistant.voice.daemon.noRecording", messageParams: {}
            });
          }
          listening.ending = true;
          queueListening(listening, { control });
        } else if (control.type === "listen.commit" || control.type === "listen.discard") {
          const active = listening;
          if (!active?.continuous || active.ending || active.turnId !== control.turnId) {
            sendJson(socket, "transcript.stale", { turnId: control.turnId, revision: control.revision });
            return;
          }
          queueListening(active, { control });
        } else if (control.type === "speak.start") {
          startSpeaking(control);
        } else if (control.type === "speak.stop-after") {
          const active = speaking;
          if (active?.turnId === control.turnId) {
            active.stopAfter = control.segmentIndex;
            active.pending.length = 0;
            active.ended = true;
            if (active.segmentIndex - 1 > control.segmentIndex) cancelSpeaking();
            else { void drainSpeech(active); return; }
          }
          sendJson(socket, "speech.end", { turnId: control.turnId });
        } else if (control.type === "speak.append" || control.type === "speak.end") {
          if (!speaking || speaking.turnId !== control.turnId || speaking.ended) {
            throw Object.assign(new Error("No matching speech stream is open."), { code: "voice_speech_not_active" });
          }
          if (control.type === "speak.append") {
            if (speaking.pending.length >= 2) {
              throw Object.assign(new Error("Speech is arriving faster than playback."), {
                code: "voice_busy", messageCode: "assistant.voice.daemon.speechTooFast", messageParams: {}
              });
            }
            speaking.pending.push(control.text);
          } else speaking.ended = true;
          void drainSpeech(speaking);
        } else if (control.type === "cancel") {
          if (listening?.turnId === control.turnId) {
            listening.cancelled = true;
            cancelListening();
          }
          if (finishing?.turnId === control.turnId) {
            finishing.cancelled = true;
            finishing.recognizer.cancel();
          }
          if (speaking?.turnId === control.turnId) {
            cancelSpeaking();
          }
          sendJson(socket, "cancelled", { turnId: control.turnId });
        }
        invalidMessages = 0;
      } catch (error) {
        failMessage(error);
      }
    });

    socket.once("close", (code) => {
      clearInterval(idleTimer);
      connection.cancel();
      releaseConnection(socket, code);
    });
    socket.once("error", (error) => {
      if (connection.closed === "client") connection.closed = "error";
      logger.warn({ error: String(error?.message || error), client: connection.client }, "Voice WebSocket failed.");
    });
    sendJson(socket, "voice.ready", {
      inputSampleRate: VOICE_INPUT_SAMPLE_RATE,
      outputSampleRate: Number(engine.sampleRate),
      ...voiceCatalogue()
    });
  });

  server.on("upgrade", (request, socket, head) => {
    if (stopping || !ready || requestPathname(request) !== VOICE_DAEMON_WEBSOCKET_PATH) {
      refuseUpgrade(socket, "503 Service Unavailable");
      return;
    }
    const principal = credentials.principalFor(bearerVoiceAccessToken(request.headers));
    if (!principal) {
      logRefusal(null, "unauthorized");
      refuseUpgrade(socket, "401 Unauthorized");
      return;
    }
    if (!connectionCapacityAvailable(principal)) {
      logRefusal(principal.client, "capacity");
      refuseUpgrade(socket, "429 Too Many Requests", "Retry-After: 2\r\n");
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request, principal);
    });
  });

  async function start() {
    if (ready) {
      return address();
    }
    credentials.start();
    try {
      await engine.warmup();
      await new Promise((resolve, reject) => {
        const fail = (error) => {
          server.off("listening", listen);
          reject(error);
        };
        const listen = () => {
          server.off("error", fail);
          resolve();
        };
        server.once("error", fail);
        server.once("listening", listen);
        server.listen(port, host);
      });
    } catch (error) {
      credentials.stop();
      throw error;
    }
    ready = true;
    startedAt = new Date().toISOString();
    return address();
  }

  function address() {
    const value = server.address();
    return value && typeof value === "object"
      ? { address: value.address, family: value.family, port: value.port }
      : null;
  }

  async function close() {
    if (stopping) {
      return;
    }
    stopping = true;
    ready = false;
    credentials.stop();
    speechQueue.close();
    for (const socket of connections.keys()) {
      closeConnection(socket, "shutdown", 1012, "Voice service restarting");
    }
    await new Promise((resolve, reject) => {
      websocketServer.close(() => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }).catch((error) => {
      if (error?.code !== "ERR_SERVER_NOT_RUNNING") {
        throw error;
      }
    });
  }

  function metrics() {
    return Object.freeze({
      clients: clientConnections.size,
      connections: connections.size,
      queueDepth: speechQueue.depth
    });
  }

  return Object.freeze({
    address,
    close,
    metrics,
    start,
    /** The SHA-256 of the credentials file in use, as /health reports it. */
    get credentialsSha256() { return credentials.sha256; }
  });
}

export {
  createBoundedSpeechQueue,
  createVoiceDaemon,
  sendJson,
  voiceDaemonError
};
