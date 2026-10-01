import { WebSocket } from "ws";

import {
  VOICE_MAX_AUDIO_FRAME_BYTES,
  VOICE_MAX_CONTROL_BYTES,
  assertVoiceAudioFrame,
  parseVoiceClientControl
} from "../shared/protocol.js";
import { normalizeVoiceCloseMetadata } from "./voiceSocketClose.js";

const WEBSOCKET_CONNECTING = 0;
const WEBSOCKET_OPEN = 1;

function closeSocket(socket, code, reason) {
  if ([WEBSOCKET_CONNECTING, WEBSOCKET_OPEN].includes(socket?.readyState)) {
    const metadata = normalizeVoiceCloseMetadata(code, reason);
    socket.close(metadata.code, metadata.reason);
  }
}

function sendSocketError(socket, code, message) {
  if (socket?.readyState === WEBSOCKET_OPEN) {
    socket.send(JSON.stringify({ code, message, type: "error" }));
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
      sendSocketError(browserSocket, "voice_unavailable", "Voice is not installed on this server.");
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
            String(error?.message || error)
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
        const code = Number(response?.statusCode) === 429 ? "voice_busy" : "voice_unavailable";
        const message = code === "voice_busy"
          ? "Voice is busy. Try again shortly."
          : "Voice service could not be reached.";
        sendSocketError(browserSocket, code, message);
        closeBoth(1013, message);
      });
      serviceSocket.once("close", (code, reason) => {
        closeBoth(code || 1012, reason?.toString() || "Voice service closed");
      });
      serviceSocket.once("error", () => {
        sendSocketError(browserSocket, "voice_unavailable", "Voice service could not be reached.");
        closeBoth(1013, "Voice service unavailable");
      });
    })().catch((error) => {
      sendSocketError(
        browserSocket,
        String(error?.code || "voice_session_failed"),
        "Voice could not open for this conversation."
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
  registerVoiceProxyRoute
};
