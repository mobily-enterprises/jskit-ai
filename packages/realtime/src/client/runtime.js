import { io as connectSocketIoClient } from "socket.io-client";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const SOCKET_IO_PATH = "/socket.io";

/**
 * @param {object} client
 * @param {string} [client.url]
 * @param {Partial<import("socket.io-client").ManagerOptions & import("socket.io-client").SocketOptions>} [client.options]
 * @param {typeof connectSocketIoClient} [client.connect]
 */
function createSocketIoClient({
  url = "",
  options = {},
  connect = connectSocketIoClient
}) {
  const normalizedUrl = normalizeText(url);
  const normalizedOptions = {
    ...normalizeObject(options),
    path: SOCKET_IO_PATH
  };
  if (normalizedUrl) {
    return connect(normalizedUrl, normalizedOptions);
  }
  return connect(normalizedOptions);
}

/** @param {import("./types.js").RealtimeSocket} socket */
function disconnectSocketIoClient(socket) {
  socket.disconnect();
}

/**
 * Socket.IO ignores connect() while its own reconnection waits out a backoff delay or an attempt left hanging by a
 * sleeping laptop. Closing that pending attempt first makes connect() open a fresh transport immediately.
 * @param {import("./types.js").RealtimeSocket} socket
 */
function reconnectSocketIoClient(socket) {
  if (socket.connected) {
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
