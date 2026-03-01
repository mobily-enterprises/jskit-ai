import { io as createSocketIoClient } from "socket.io-client";

const DEFAULT_SOCKET_IO_TRANSPORT_OPTIONS = Object.freeze({
  path: "/api/v1/realtime",
  messageEvent: "realtime:message",
  transports: Object.freeze(["websocket"])
});

function normalizeSurface(surfaceValue = "") {
  const surface = String(surfaceValue || "")
    .trim()
    .toLowerCase();
  return surface || "app";
}

function normalizePath(pathValue) {
  const path = String(pathValue || "").trim();
  return path || DEFAULT_SOCKET_IO_TRANSPORT_OPTIONS.path;
}

function normalizeMessageEvent(messageEventValue) {
  const messageEvent = String(messageEventValue || "").trim();
  return messageEvent || DEFAULT_SOCKET_IO_TRANSPORT_OPTIONS.messageEvent;
}

function normalizeTransports(transportsValue) {
  if (!Array.isArray(transportsValue)) {
    return [...DEFAULT_SOCKET_IO_TRANSPORT_OPTIONS.transports];
  }

  const normalized = transportsValue.map((entry) => String(entry || "").trim()).filter(Boolean);
  if (normalized.length < 1) {
    return [...DEFAULT_SOCKET_IO_TRANSPORT_OPTIONS.transports];
  }

  return normalized;
}

function assertRealtimeTransport(transport) {
  if (!transport || typeof transport !== "object") {
    throw new Error("transport is required.");
  }

  if (typeof transport.createConnection !== "function") {
    throw new Error("transport.createConnection is required.");
  }

  const messageEvent = String(transport.messageEvent || "").trim();
  if (!messageEvent) {
    throw new Error("transport.messageEvent is required.");
  }
}

function createSocketIoTransport(options = {}) {
  const socketFactory = typeof options.socketFactory === "function" ? options.socketFactory : createSocketIoClient;
  const path = normalizePath(options.path);
  const messageEvent = normalizeMessageEvent(options.messageEvent);
  const transports = normalizeTransports(options.transports);
  const baseQuery =
    options.query && typeof options.query === "object" && !Array.isArray(options.query) ? { ...options.query } : {};

  return {
    messageEvent,
    createConnection({ url, surface } = {}) {
      const normalizedUrl = String(url || "").trim();
      if (!normalizedUrl) {
        throw new Error("A realtime url is required to create a connection.");
      }

      return socketFactory(normalizedUrl, {
        path,
        transports,
        autoConnect: false,
        reconnection: false,
        query: {
          ...baseQuery,
          surface: normalizeSurface(surface)
        }
      });
    }
  };
}

export { createSocketIoTransport, assertRealtimeTransport, DEFAULT_SOCKET_IO_TRANSPORT_OPTIONS };
