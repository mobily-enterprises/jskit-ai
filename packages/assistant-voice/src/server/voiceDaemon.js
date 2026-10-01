import http from "node:http";

import { WebSocketServer } from "ws";

import {
  VOICE_DAEMON_WEBSOCKET_PATH,
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_MAX_AUDIO_FRAME_BYTES,
  VOICE_MAX_CONTROL_BYTES,
  VOICE_MAX_UTTERANCE_SECONDS,
  VOICE_PROTOCOL_VERSION,
  assertVoiceAudioFrame,
  parseVoiceClientControl,
  speechPauseDurationMs,
  splitSpeechText,
  voiceServerMessage
} from "../shared/protocol.js";
import { visemeCuesFromText } from "../shared/visemes.js";
import {
  bearerVoiceAccessToken,
  verifyVoiceAccessToken
} from "./voiceAccessToken.js";

const WEBSOCKET_OPEN = 1;

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

function voiceDaemonError(error, fallback = "Voice operation failed.") {
  return {
    code: String(error?.code || "voice_operation_failed"),
    message: String(error?.message || error || fallback)
  };
}

function createBoundedSerialQueue({ maximumQueued = 4 } = {}) {
  const pending = [];
  let running = false;
  let closed = false;

  const drain = async () => {
    if (running || closed) {
      return;
    }
    const next = pending.shift();
    if (!next) {
      return;
    }
    running = true;
    try {
      next.resolve(await next.operation());
    } catch (error) {
      next.reject(error);
    } finally {
      running = false;
      void drain();
    }
  };

  return Object.freeze({
    close() {
      closed = true;
      const error = new Error("Voice speech queue is shutting down.");
      error.code = "voice_queue_closed";
      for (const entry of pending.splice(0)) {
        entry.reject(error);
      }
    },
    get depth() {
      return pending.length + (running ? 1 : 0);
    },
    run(operation) {
      if (closed) {
        const error = new Error("Voice speech queue is unavailable.");
        error.code = "voice_queue_closed";
        return Promise.reject(error);
      }
      if (typeof operation !== "function") {
        return Promise.reject(new TypeError("Voice speech queue requires an operation."));
      }
      if (pending.length >= maximumQueued) {
        const error = new Error("Voice speech capacity is currently busy. Try again shortly.");
        error.code = "voice_busy";
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        pending.push({ operation, reject, resolve });
        void drain();
      });
    }
  });
}

function requestPathname(request = {}) {
  try {
    return new URL(String(request.url || "/"), "http://voice.local").pathname;
  } catch {
    return "/";
  }
}

function writeJsonResponse(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": String(body.byteLength),
    "content-type": "application/json; charset=utf-8"
  });
  response.end(body);
}

function createVoiceDaemon({
  accessKey,
  authorize = token => verifyVoiceAccessToken(token, { key: accessKey }),
  handleRequest = null,
  engine,
  host = "127.0.0.1",
  idleTimeoutMs = 90_000,
  logger = console,
  maximumConnections = 8,
  maximumConnectionsPerTenant = 2,
  maximumQueuedSpeech = 4,
  port = 3092
} = {}) {
  if (!engine || typeof engine.createListeningSession !== "function" || typeof engine.synthesize !== "function") {
    throw new TypeError("createVoiceDaemon requires a speech engine.");
  }
  if (typeof authorize !== "function" || (handleRequest !== null && typeof handleRequest !== "function")) throw new TypeError("Voice host authorization and request handlers must be functions.");
  const tenantConnections = new Map();
  const sockets = new Set();
  const principals = new WeakMap();
  const speechQueue = createBoundedSerialQueue({ maximumQueued: maximumQueuedSpeech });
  let ready = false;
  let startedAt = "";
  let stopping = false;
  const voiceCatalogue = () => ({
    voices: (engine.voices || []).map(({ id, label, language }) => ({ id, label, ...(language ? { language } : {}) })),
    defaultVoice: engine.defaultVoice || ""
  });
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && requestPathname(request) === "/health") {
      writeJsonResponse(response, ready && !stopping ? 200 : 503, {
        connections: sockets.size,
        ok: ready && !stopping,
        protocolVersion: VOICE_PROTOCOL_VERSION,
        queueDepth: speechQueue.depth,
        startedAt
      });
      return;
    }
    try {
      if (request.method === "GET" && requestPathname(request) === "/voices") {
        let principal;
        try { principal = await authorize(bearerVoiceAccessToken(request.headers), request); } catch { /* Deny invalid credentials. */ }
        if (!principal) { writeJsonResponse(response, 401, { ok: false }); return; }
        if (!ready || stopping) { writeJsonResponse(response, 503, { ok: false }); return; }
        writeJsonResponse(response, 200, voiceCatalogue());
        return;
      }
      if (await handleRequest?.(request, response)) return;
      writeJsonResponse(response, 404, { ok: false });
    } catch {
      if (!response.headersSent) writeJsonResponse(response, 500, { ok: false, error: "Voice host request failed." });
      else response.end();
    }
  });
  const websocketServer = new WebSocketServer({
    maxPayload: Math.max(VOICE_MAX_AUDIO_FRAME_BYTES, VOICE_MAX_CONTROL_BYTES),
    noServer: true,
    perMessageDeflate: false
  });

  function quotaKeys(principal) { return [...new Set([principal.tenant, principal.parentTenant].filter(Boolean))]; }

  function connectionCapacityAvailable(principal) {
    return sockets.size < maximumConnections && quotaKeys(principal).every(key =>
      (tenantConnections.get(key) || 0) < maximumConnectionsPerTenant);
  }

  function claimConnection(principal, socket) {
    sockets.add(socket);
    principals.set(socket, { ...principal });
    for (const key of quotaKeys(principal)) tenantConnections.set(key, (tenantConnections.get(key) || 0) + 1);
  }

  function releaseConnection(socket) {
    if (!sockets.delete(socket)) return;
    for (const key of quotaKeys(principals.get(socket))) {
      const next = (tenantConnections.get(key) || 1) - 1;
      if (next) tenantConnections.set(key, next);
      else tenantConnections.delete(key);
    }
    principals.delete(socket);
  }

  function revokeTenant(tenant) {
    for (const socket of sockets) {
      if (quotaKeys(principals.get(socket)).includes(tenant)) {
        principals.get(socket).cancel?.();
        sendJson(socket, "error", { code: "voice_access_revoked", message: "This application's voice access was revoked." });
        socket.close(1008, "Voice access was revoked");
      }
    }
  }

  websocketServer.on("connection", (socket, request, context = {}) => {
    const tenantId = context.tenant;
    claimConnection(context, socket);
    let listening = null;
    let speaking = null;
    let invalidMessages = 0;
    let lastActivity = Date.now();

    const cancelListening = () => {
      clearImmediate(listening?.decodeTimer);
      listening?.recognizer?.cancel?.();
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
      socket.close(1000, "Voice connection idle");
    }, Math.min(idleTimeoutMs, 15_000));
    idleTimer.unref?.();

    const failMessage = (error) => {
      invalidMessages += 1;
      const publicError = voiceDaemonError(error);
      sendJson(socket, "error", publicError);
      if (invalidMessages >= 3) {
        socket.close(1008, "Invalid voice protocol messages");
      }
    };

    principals.get(socket).cancel = () => { cancelListening(); cancelSpeaking(); };

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
        pending: [], pendingBytes: 0, decodeTimer: null, ending: false };
      sendJson(socket, "listen.started", { turnId });
    };

    const drainListening = (active) => {
      if (active.decodeTimer || listening !== active || !active.pending.length) return;
      // Native recognition is synchronous. Yield between small audio slices so
      // a burst of microphone frames cannot starve PCM delivery or controls.
      active.decodeTimer = setImmediate(() => {
        active.decodeTimer = null;
        if (listening !== active) return;
        const { frame, control } = active.pending.shift();
        try {
          if (frame) {
            active.pendingBytes -= frame.byteLength;
            if (active.recognizer.acceptedSamples + frame.byteLength / 2 > VOICE_INPUT_SAMPLE_RATE * VOICE_MAX_UTTERANCE_SECONDS) {
              throw Object.assign(new Error(`Voice recordings are limited to ${VOICE_MAX_UTTERANCE_SECONDS} seconds.`), {
                code: "voice_utterance_too_long"
              });
            }
            active.recognizer.acceptPcm(frame);
          } else if (control.type === "listen.stop") {
            listening = null;
            const text = active.recognizer.finish();
            sendJson(socket, "transcript.final", { text, turnId: active.turnId });
          } else if (!active.continuous || active.candidateRevision !== control.revision || !active.recognizer.isEndpoint()) {
            sendJson(socket, "transcript.stale", { turnId: active.turnId, revision: control.revision });
          } else {
            const text = active.recognizer.reset();
            active.candidateRevision = 0;
            active.revision += 1;
            if (control.type === "listen.commit") sendJson(socket, "transcript.final", {
              text, turnId: active.turnId, revision: control.revision, continuous: true
            });
            sendJson(socket, "transcript.reset", { turnId: active.turnId, revision: active.revision });
          }
        } catch (error) {
          if (listening === active) cancelListening();
          else active.recognizer.cancel();
          failMessage(error);
        }
        drainListening(active);
      });
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
      drainListening(active);
    };

    const drainSpeech = async (active) => {
      if (active.processing || speaking !== active) return;
      active.processing = true;
      const { controller, turnId } = active;
      try {
        while (active.pending.length && !controller.signal.aborted) {
          const chunk = active.pending.shift();
          // Queue each phrase separately so another tenant can get a turn.
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
              sendJson(socket, "speech.segment.start", { segmentIndex, turnId });
              let sampleCount = 0;
              const result = text.trim() ? await engine.synthesize(text.trim(), {
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
          ...voiceDaemonError(error, "Speech could not be generated."), turnId
        });
        controller.abort();
        if (speaking === active) speaking = null;
      } finally { active.processing = false; }
    };

    const startSpeaking = (control) => {
      const voiceId = control.voiceId || engine.defaultVoice;
      if (voiceId && !engine.voices?.some(voice => voice.id === voiceId)) {
        throw Object.assign(new Error("This voice is unavailable. Choose another voice."), { code: "voice_selection_invalid" });
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
            const error = new Error("Audio arrived without an active recording.");
            error.code = "voice_listen_not_active";
            throw error;
          }
          const frame = assertVoiceAudioFrame(raw);
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
            throw Object.assign(new Error("No matching voice recording is active."), { code: "voice_listen_not_active" });
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
            if (speaking.pending.length >= 2) throw Object.assign(new Error("Speech is arriving faster than playback."), { code: "voice_busy" });
            speaking.pending.push(control.text);
          } else speaking.ended = true;
          void drainSpeech(speaking);
        } else if (control.type === "cancel") {
          if (listening?.turnId === control.turnId) {
            cancelListening();
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

    socket.once("close", () => {
      clearInterval(idleTimer);
      cancelListening();
      cancelSpeaking();
      releaseConnection(socket);
    });
    socket.once("error", (error) => {
      logger?.warn?.({ error: String(error?.message || error), tenantId }, "Voice WebSocket failed.");
    });
    sendJson(socket, "voice.ready", {
      inputSampleRate: VOICE_INPUT_SAMPLE_RATE,
      outputSampleRate: Number(engine.sampleRate),
      ...voiceCatalogue()
    });
  });

  server.on("upgrade", (request, socket, head) => {
    if (stopping || !ready || requestPathname(request) !== VOICE_DAEMON_WEBSOCKET_PATH) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    let verified;
    try { verified = authorize(bearerVoiceAccessToken(request.headers), request); }
    catch { verified = null; }
    if (!verified || typeof verified.tenant !== "string" || !verified.tenant) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!connectionCapacityAvailable(verified)) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nRetry-After: 2\r\n\r\n");
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request, verified);
    });
  });

  async function start() {
    if (ready) {
      return address();
    }
    await engine.warmup?.();
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
    speechQueue.close();
    for (const socket of sockets) {
      socket.close(1012, "Voice service restarting");
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

  return Object.freeze({
    address,
    close,
    revokeTenant,
    metrics() {
      return Object.freeze({
        connections: sockets.size,
        queueDepth: speechQueue.depth,
        tenants: tenantConnections.size
      });
    },
    start
  });
}

export {
  createBoundedSerialQueue,
  createVoiceDaemon,
  sendJson,
  voiceDaemonError
};
