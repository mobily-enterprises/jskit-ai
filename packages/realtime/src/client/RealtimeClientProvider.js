import { createSocketIoClient, disconnectSocketIoClient } from "./runtime.js";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createProviderLogger as createSharedProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { getClientAppConfig, resolveClientBootstrapDebugEnabled, resolveMobileConfig } from "@jskit-ai/kernel/client";
import RealtimeConnectionIndicator from "./components/RealtimeConnectionIndicator.js";
import { resolveRealtimeClientListeners } from "./listeners.js";

const REALTIME_RUNTIME_CLIENT_API = Object.freeze({
  createSocketIoClient,
  disconnectSocketIoClient
});

function isCapacitorRuntimeAvailable(app) {
  if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
    return false;
  }
  if (app.has("mobile.capacitor.adapter.client") !== true) {
    return false;
  }

  const adapter = app.make("mobile.capacitor.adapter.client");
  return adapter?.available === true;
}

function resolveRealtimeClientConfig(app) {
  const appConfig = normalizeObject(getClientAppConfig());
  const env = app && typeof app.has === "function" && app.has("jskit.client.env") ? normalizeObject(app.make("jskit.client.env")) : {};
  const realtime = normalizeObject(appConfig.realtime);
  const realtimeClient = normalizeObject(appConfig.realtimeClient);
  const mobileConfig = resolveMobileConfig({
    mobile: normalizeObject(appConfig.mobile)
  });
  const url = normalizeText(
    realtimeClient.url || (mobileConfig.enabled === true && isCapacitorRuntimeAvailable(app) ? mobileConfig.apiBaseUrl : "")
  );
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
  static id = "runtime.realtime.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("RealtimeClientProvider requires application singleton().");
    }

    app.singleton("runtime.realtime.client", () => REALTIME_RUNTIME_CLIENT_API);
    app.singleton("realtime.web.connection.indicator", () => RealtimeConnectionIndicator);
    app.singleton("runtime.realtime.client.socket", (scope) => {
      const realtimeRuntime = scope.make("runtime.realtime.client");
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
    const logger = createSharedProviderLogger(app, {
      debugEnabled: realtimeClientConfig.debugEnabled
    });
    const socket = app.make("runtime.realtime.client.socket");
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

    if (!app.has("jskit.client.vue.app")) {
      return;
    }

    const vueApp = app.make("jskit.client.vue.app");
    if (!vueApp || typeof vueApp.provide !== "function") {
      return;
    }
    vueApp.provide("jskit.realtime.runtime.client.socket", socket);
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
      app && typeof app.make === "function" ? app.make("runtime.realtime.client") : REALTIME_RUNTIME_CLIENT_API;
    runtimeApi.disconnectSocketIoClient(this.socket);
    this.socket = null;
  }
}

export { RealtimeClientProvider };
