import WebSocket from "ws";

function resolveRealtimeTransport({
  nativeWebSocket = globalThis.WebSocket,
  fallbackTransport = WebSocket
} = {}) {
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
