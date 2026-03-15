import { createSocketIoClient, disconnectSocketIoClient } from "./runtime.js";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  CLIENT_MODULE_ENV_TOKEN,
  CLIENT_MODULE_VUE_APP_TOKEN
} from "@jskit-ai/kernel/client/moduleBootstrap";
import { resolveClientBootstrapDebugEnabled } from "@jskit-ai/kernel/client";
import {
  REALTIME_RUNTIME_CLIENT_TOKEN,
  REALTIME_SOCKET_CLIENT_TOKEN,
  REALTIME_SOCKET_CLIENT_INJECTION_KEY
} from "./tokens.js";
import { resolveRealtimeClientListeners } from "./listeners.js";

const REALTIME_RUNTIME_CLIENT_API = Object.freeze({
  createSocketIoClient,
  disconnectSocketIoClient
});

function createProviderLogger(app, { debugEnabled = false } = {}) {
  return Object.freeze({
    debug: (...args) => {
      if (debugEnabled !== true) {
        return;
      }
      if (app && typeof app.info === "function") {
        app.info(...args);
        return;
      }
      console.info(...args);
    },
    info: (...args) => {
      if (app && typeof app.info === "function") {
        app.info(...args);
        return;
      }
      console.info(...args);
    },
    warn: (...args) => {
      if (app && typeof app.warn === "function") {
        app.warn(...args);
        return;
      }
      console.warn(...args);
    },
    error: (...args) => {
      if (app && typeof app.error === "function") {
        app.error(...args);
        return;
      }
      console.error(...args);
    }
  });
}

function resolveRealtimeClientConfig(app) {
  const appConfig = app && typeof app.has === "function" && app.has("appConfig") ? normalizeObject(app.make("appConfig")) : {};
  const env = app && typeof app.has === "function" && app.has(CLIENT_MODULE_ENV_TOKEN) ? normalizeObject(app.make(CLIENT_MODULE_ENV_TOKEN)) : {};
  const realtime = normalizeObject(appConfig.realtime);
  const realtimeClient = normalizeObject(appConfig.realtimeClient);
  const url = normalizeText(realtimeClient.url);
  const options = normalizeObject(realtimeClient.options);
  const explicitDebugEnabled =
    typeof realtimeClient.debug === "boolean"
      ? realtimeClient.debug
      : typeof realtime.debug === "boolean"
        ? realtime.debug
        : undefined;
  const hasRealtimeDebugEnvOverride = Object.hasOwn(env, "VITE_REALTIME_DEBUG");
  const debugEnabled = hasRealtimeDebugEnvOverride
    ? resolveClientBootstrapDebugEnabled({
        env,
        debugEnabled: undefined,
        debugEnvKey: "VITE_REALTIME_DEBUG"
      })
    : resolveClientBootstrapDebugEnabled({
        env,
        debugEnabled: explicitDebugEnabled,
        debugEnvKey: "VITE_REALTIME_DEBUG"
      });

  return Object.freeze({
    url,
    options,
    debugEnabled
  });
}

class RealtimeClientProvider {
  static id = REALTIME_RUNTIME_CLIENT_TOKEN;

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("RealtimeClientProvider requires application singleton().");
    }

    app.singleton(REALTIME_RUNTIME_CLIENT_TOKEN, () => REALTIME_RUNTIME_CLIENT_API);
    app.singleton(REALTIME_SOCKET_CLIENT_TOKEN, (scope) => {
      const realtimeRuntime = scope.make(REALTIME_RUNTIME_CLIENT_TOKEN);
      const realtimeClientConfig = resolveRealtimeClientConfig(scope);
      return realtimeRuntime.createSocketIoClient({
        url: realtimeClientConfig.url,
        options: realtimeClientConfig.options
      });
    });
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("RealtimeClientProvider requires application make().");
    }

    const realtimeClientConfig = resolveRealtimeClientConfig(app);
    const logger = createProviderLogger(app, {
      debugEnabled: realtimeClientConfig.debugEnabled
    });
    const socket = app.make(REALTIME_SOCKET_CLIENT_TOKEN);
    const listeners = resolveRealtimeClientListeners(app);
    const detach = [];

    logger.debug(
      {
        providerId: RealtimeClientProvider.id,
        listenerCount: listeners.length,
        listeners: listeners.map((listener) => ({
          listenerId: listener.listenerId,
          event: listener.event
        }))
      },
      "Realtime client booted listeners."
    );

    if (typeof socket.on === "function") {
      const onConnect = () => {
        logger.debug(
          {
            providerId: RealtimeClientProvider.id,
            socketConnected: true
          },
          "Realtime client socket connected."
        );
      };
      const onDisconnect = (reason) => {
        logger.debug(
          {
            providerId: RealtimeClientProvider.id,
            socketConnected: false,
            reason: String(reason || "")
          },
          "Realtime client socket disconnected."
        );
      };
      const onConnectError = (error) => {
        logger.warn(
          {
            providerId: RealtimeClientProvider.id,
            error: String(error?.message || error || "unknown error")
          },
          "Realtime client socket connect error."
        );
      };

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onConnectError);
      detach.push(() => {
        if (typeof socket.off === "function") {
          socket.off("connect", onConnect);
          socket.off("disconnect", onDisconnect);
          socket.off("connect_error", onConnectError);
        }
      });

      if (realtimeClientConfig.debugEnabled === true && typeof socket.onAny === "function") {
        const onAnyDebug = (eventName, payload) => {
          logger.debug(
            {
              providerId: RealtimeClientProvider.id,
              event: String(eventName || ""),
              payloadScope: payload?.scope || null,
              payloadEntityId: payload?.entityId || null
            },
            "Realtime client received socket event."
          );
        };
        socket.onAny(onAnyDebug);
        detach.push(() => {
          if (typeof socket.offAny === "function") {
            socket.offAny(onAnyDebug);
          }
        });
      }
    }

    for (const listener of listeners) {
      const invoke = (eventName, payload) => {
        const context = Object.freeze({
          event: eventName,
          payload,
          socket,
          app
        });

        if (listener.matches && listener.matches(context) !== true) {
          logger.debug(
            {
              listenerId: listener.listenerId,
              event: eventName
            },
            "Realtime client listener skipped event by matches()."
          );
          return;
        }

        logger.debug(
          {
            listenerId: listener.listenerId,
            event: eventName,
            payloadScope: payload?.scope || null,
            payloadEntityId: payload?.entityId || null
          },
          "Realtime client listener handling event."
        );

        Promise.resolve(listener.handle(context)).catch((error) => {
          logger.error(
            {
              listenerId: listener.listenerId,
              event: eventName,
              error: String(error?.message || error || "unknown error")
            },
            "Realtime client listener failed."
          );
        });
      };

      if (listener.event === "*") {
        if (typeof socket.onAny === "function") {
          const onAny = (eventName, payload) => invoke(eventName, payload);
          socket.onAny(onAny);
          detach.push(() => {
            if (typeof socket.offAny === "function") {
              socket.offAny(onAny);
            }
          });
        }
        continue;
      }

      if (typeof socket.on === "function") {
        const onEvent = (payload) => invoke(listener.event, payload);
        socket.on(listener.event, onEvent);
        detach.push(() => {
          if (typeof socket.off === "function") {
            socket.off(listener.event, onEvent);
          }
        });
      }
    }

    this.socket = socket;
    this.detach = detach;

    if (!app.has(CLIENT_MODULE_VUE_APP_TOKEN)) {
      return;
    }

    const vueApp = app.make(CLIENT_MODULE_VUE_APP_TOKEN);
    if (!vueApp || typeof vueApp.provide !== "function") {
      return;
    }
    vueApp.provide(REALTIME_SOCKET_CLIENT_INJECTION_KEY, socket);
  }

  shutdown(app) {
    if (Array.isArray(this.detach)) {
      for (const release of this.detach) {
        if (typeof release === "function") {
          try {
            release();
          } catch {}
        }
      }
    }
    this.detach = [];

    if (!this.socket) {
      return;
    }

    const runtimeApi =
      app && typeof app.make === "function" ? app.make(REALTIME_RUNTIME_CLIENT_TOKEN) : REALTIME_RUNTIME_CLIENT_API;
    runtimeApi.disconnectSocketIoClient(this.socket);
    this.socket = null;
  }
}

export { RealtimeClientProvider };
