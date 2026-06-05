import WebSocket from "ws";

function resolveRealtimeTransport(options = {}) {
  const nativeWebSocket = Object.hasOwn(options, "nativeWebSocket")
    ? options.nativeWebSocket
    : globalThis.WebSocket;
  const { fallbackTransport = WebSocket } = options;

  if (typeof nativeWebSocket === "function") {
    return null;
  }

  if (typeof fallbackTransport === "function") {
    return fallbackTransport;
  }

  return null;
}

export function buildSupabaseServerClientOptions(options = {}) {
  const realtimeTransport = resolveRealtimeTransport(options);
  const clientOptions = {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  };

  if (realtimeTransport) {
    clientOptions.realtime = {
      transport: realtimeTransport
    };
  }

  return clientOptions;
}
