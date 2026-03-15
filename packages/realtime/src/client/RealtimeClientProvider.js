import { createSocketIoClient, disconnectSocketIoClient } from "./runtime.js";
import { REALTIME_RUNTIME_CLIENT_TOKEN } from "./tokens.js";

const REALTIME_RUNTIME_CLIENT_API = Object.freeze({
  createSocketIoClient,
  disconnectSocketIoClient
});

class RealtimeClientProvider {
  static id = REALTIME_RUNTIME_CLIENT_TOKEN;

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("RealtimeClientProvider requires application singleton().");
    }

    app.singleton(REALTIME_RUNTIME_CLIENT_TOKEN, () => REALTIME_RUNTIME_CLIENT_API);
  }

  boot() {}
}

export { RealtimeClientProvider };
