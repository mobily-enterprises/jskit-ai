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

export {
  createSocketIoClient,
  disconnectSocketIoClient
};
