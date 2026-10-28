import { io as connectSocketIoClient } from "socket.io-client";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const SOCKET_IO_PATH = "/socket.io";

function createSocketIoClient({
  url = "",
  options = {},
  connect = connectSocketIoClient
} = {}) {
  if (typeof connect !== "function") {
    throw new Error("createSocketIoClient requires a valid socket.io client connect function.");
  }

  const normalizedUrl = normalizeText(url);
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const normalizedOptions = {
    ...source,
    path: SOCKET_IO_PATH
  };
  if (normalizedUrl) {
    return connect(normalizedUrl, normalizedOptions);
  }
  return connect(normalizedOptions);
}

function disconnectSocketIoClient(socket) {
  if (!socket || typeof socket.disconnect !== "function") {
    return;
  }
  socket.disconnect();
}

// Socket.IO ignores connect() while its own reconnection waits out a backoff
// delay or an attempt left hanging by a sleeping laptop. Closing that pending
// attempt first makes connect() open a fresh transport immediately.
function reconnectSocketIoClient(socket) {
  if (!socket || socket.connected || typeof socket.connect !== "function") {
    return;
  }
  if (socket.active) {
    socket.disconnect();
  }
  socket.connect();
}

export {
  createSocketIoClient,
  disconnectSocketIoClient,
  reconnectSocketIoClient
};
