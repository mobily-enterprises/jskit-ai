import { WebSocket } from "ws";

import {
  VOICE_MAX_AUDIO_FRAME_BYTES,
  VOICE_MAX_CONTROL_BYTES,
  assertVoiceAudioFrame,
  parseVoiceClientControl,
  voiceServerMessage
} from "../shared/protocol.js";

const WEBSOCKET_CONNECTING = 0;
const WEBSOCKET_OPEN = 1;

const RESERVED_CLOSE_CODES = new Set([1004, 1005, 1006, 1015]);

function proxyCloseCode(code) {
  const numericCode = Number(code);
  const isStandardCode = Number.isInteger(numericCode)
    && numericCode >= 1000
    && numericCode <= 1014
    && !RESERVED_CLOSE_CODES.has(numericCode);
  const isApplicationCode = Number.isInteger(numericCode)
    && numericCode >= 3000
    && numericCode <= 4999;
  return isStandardCode || isApplicationCode ? numericCode : 1000;
}

function proxyCloseReason(reason) {
  const encoded = Buffer.from(String(reason || ""), "utf8");
  return encoded.byteLength <= 123
    ? encoded.toString("utf8")
    : encoded.subarray(0, 120).toString("utf8");
}

function normalizeVoiceCloseMetadata(code, reason) {
  return Object.freeze({
    code: proxyCloseCode(code),
    reason: proxyCloseReason(reason)
  });
}

async function readVoiceCatalogue(config, { fetchImpl = fetch } = {}) {
  try {
    if (!config?.available) throw new Error("Voice is not configured.");
    const url = new URL("/voices", config.endpoint);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("Voice service refused the catalogue request.");
    const catalogue = await response.json();
    if (!Array.isArray(catalogue.voices) || typeof catalogue.defaultVoice !== "string") throw new Error("Invalid voice catalogue.");
    return catalogue;
  } catch (cause) {
    throw Object.assign(new Error("Speaking voices could not load. Check the speech service and retry."), {
      code: "voice_unavailable", statusCode: 503, cause,
      messageCode: "assistant.voice.proxy.voicesUnavailable", messageParams: {}
    });
  }
}

function closeSocket(socket, code, reason) {
  if ([WEBSOCKET_CONNECTING, WEBSOCKET_OPEN].includes(socket?.readyState)) {
    const metadata = normalizeVoiceCloseMetadata(code, reason);
    socket.close(metadata.code, metadata.reason);
  }
}

// code and message stay the wire contract. params fill a catalogued code's sentence,
// and messageCode names the sentence where one code has several.
function sendSocketError(socket, code, message, { params, messageCode, messageParams = {} } = {}) {
  if (socket?.readyState === WEBSOCKET_OPEN) {
    socket.send(voiceServerMessage("error", {
      code, message, ...(params ? { params } : {}), ...(messageCode ? { messageCode, messageParams } : {})
    }));
  }
}

function registerVoiceProxyRoute(fastify, {
  proxyConfig,
  route,
  authorize = null,
  WebSocketCtor = WebSocket
} = {}) {
  if (!fastify || typeof fastify.get !== "function") {
    throw new TypeError("registerVoiceProxyRoute requires Fastify get().");
  }
  if (typeof authorize !== "function" || typeof route !== "string" || !route.startsWith("/")) {
    throw new TypeError("registerVoiceProxyRoute requires an application route and authorization function.");
  }
  const config = proxyConfig || { available: false, endpoint: "", token: "" };

  fastify.get(route, { websocket: true }, (browserSocket, request) => {
    let serviceSocket = null;
    let closed = false;

    const closeBoth = (code = 1000, reason = "Voice connection closed") => {
      if (closed) {
        return;
      }
      closed = true;
      closeSocket(browserSocket, code, reason);
      closeSocket(serviceSocket, code, reason);
    };
    browserSocket.once("close", (code, reason) => {
      closeBoth(code || 1000, reason?.toString() || "Browser closed voice");
    });
    browserSocket.once("error", () => closeBoth(1011, "Browser voice connection failed"));

    if (!config.available) {
      sendSocketError(browserSocket, "voice_unavailable", "Voice is not installed on this server.", {
        messageCode: "assistant.voice.proxy.notInstalled"
      });
      closeBoth(1013, "Voice service unavailable");
      return;
    }

    void (async () => {
      const authorized = await authorize(request);
      if (authorized === false) {
        sendSocketError(browserSocket, "voice_auth_required", "Voice access was denied.");
        closeBoth(1008, "Voice access denied");
        return;
      }
      if (closed) {
        return;
      }

      serviceSocket = new WebSocketCtor(config.endpoint, {
        headers: {
          authorization: `Bearer ${config.token}`
        },
        maxPayload: Math.max(VOICE_MAX_AUDIO_FRAME_BYTES, VOICE_MAX_CONTROL_BYTES),
        perMessageDeflate: false
      });

      const pendingFrames = [];
      let pendingBytes = 0;
      const forwardToService = (raw, isBinary) => {
        if (closed) {
          return;
        }
        const frame = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        const limit = isBinary ? VOICE_MAX_AUDIO_FRAME_BYTES : VOICE_MAX_CONTROL_BYTES;
        if (frame.byteLength > limit) {
          sendSocketError(browserSocket, "voice_frame_too_large", "Voice message is too large.");
          closeBoth(1009, "Voice message too large");
          return;
        }
        try {
          if (isBinary) {
            assertVoiceAudioFrame(frame);
          } else {
            parseVoiceClientControl(frame);
          }
        } catch (error) {
          sendSocketError(
            browserSocket,
            String(error?.code || "voice_control_invalid"),
            String(error?.message || error),
            { params: error?.params, messageCode: error?.messageCode, messageParams: error?.messageParams }
          );
          return;
        }
        if (serviceSocket.readyState === WEBSOCKET_OPEN) {
          serviceSocket.send(frame, { binary: isBinary });
          return;
        }
        if (serviceSocket.readyState !== WEBSOCKET_CONNECTING || pendingBytes + frame.byteLength > 128 * 1024) {
          sendSocketError(browserSocket, "voice_connecting", "Voice is still connecting. Try again.");
          return;
        }
        pendingFrames.push({ frame, isBinary });
        pendingBytes += frame.byteLength;
      };

      browserSocket.on("message", forwardToService);

      serviceSocket.once("open", () => {
        for (const entry of pendingFrames.splice(0)) {
          if (serviceSocket.readyState !== WEBSOCKET_OPEN) {
            break;
          }
          serviceSocket.send(entry.frame, { binary: entry.isBinary });
        }
        pendingBytes = 0;
      });
      serviceSocket.on("message", (raw, isBinary) => {
        if (browserSocket.readyState !== WEBSOCKET_OPEN) {
          return;
        }
        const frame = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        const limit = isBinary ? VOICE_MAX_AUDIO_FRAME_BYTES : VOICE_MAX_CONTROL_BYTES;
        if (frame.byteLength > limit) {
          closeBoth(1009, "Voice service message too large");
          return;
        }
        browserSocket.send(frame, { binary: isBinary });
      });
      serviceSocket.once("unexpected-response", (_request, response) => {
        const { code, message, messageCode } = Number(response?.statusCode) === 429
          ? { code: "voice_busy", message: "Voice is busy. Try again shortly.", messageCode: "assistant.voice.proxy.busy" }
          : { code: "voice_unavailable", message: "Voice service could not be reached.", messageCode: "assistant.voice.proxy.unreachable" };
        sendSocketError(browserSocket, code, message, { messageCode });
        closeBoth(1013, message);
      });
      serviceSocket.once("close", (code, reason) => {
        closeBoth(code || 1012, reason?.toString() || "Voice service closed");
      });
      serviceSocket.once("error", () => {
        sendSocketError(browserSocket, "voice_unavailable", "Voice service could not be reached.", {
          messageCode: "assistant.voice.proxy.unreachable"
        });
        closeBoth(1013, "Voice service unavailable");
      });
    })().catch((error) => {
      sendSocketError(
        browserSocket,
        String(error?.code || "voice_session_failed"),
        "Voice could not open for this conversation.",
        { messageCode: "assistant.voice.proxy.sessionFailed" }
      );
      closeBoth([401, 403].includes(error?.statusCode) ? 1008 : 1011, "Voice session failed");
    });
  });

  return Object.freeze({
    available: config.available,
    route
  });
}

export {
  closeSocket,
  readVoiceCatalogue,
  registerVoiceProxyRoute
};
