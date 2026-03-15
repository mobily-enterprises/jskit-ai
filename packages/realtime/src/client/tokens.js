const REALTIME_RUNTIME_CLIENT_TOKEN = "runtime.realtime.client";
const REALTIME_SOCKET_CLIENT_TOKEN = "runtime.realtime.client.socket";
const REALTIME_SOCKET_CLIENT_INJECTION_KEY = Symbol.for("jskit.realtime.runtime.client.socket");
const REALTIME_CLIENT_LISTENER_TAG = Symbol.for("jskit.runtime.realtime.client.listeners");

export {
  REALTIME_RUNTIME_CLIENT_TOKEN,
  REALTIME_SOCKET_CLIENT_TOKEN,
  REALTIME_SOCKET_CLIENT_INJECTION_KEY,
  REALTIME_CLIENT_LISTENER_TAG
};
