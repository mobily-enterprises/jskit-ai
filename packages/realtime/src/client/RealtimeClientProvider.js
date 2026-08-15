import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { getClientAppConfig, resolveClientBootstrapDebugEnabled, resolveMobileConfig } from "@jskit-ai/kernel/client";
import RealtimeConnectionIndicator from "./components/RealtimeConnectionIndicator.js";
import { createSocketIoClient, disconnectSocketIoClient } from "./runtime.js";

const REALTIME_RUNTIME_CLIENT_API = Object.freeze({
  createSocketIoClient,
  disconnectSocketIoClient
});

function resolveRealtimeClientConfig({ env = {}, mobile = null } = {}) {
  const appConfig = normalizeObject(getClientAppConfig());
  const realtime = normalizeObject(appConfig.realtime);
  const realtimeClient = normalizeObject(appConfig.realtimeClient);
  const mobileConfig = resolveMobileConfig({ mobile: normalizeObject(appConfig.mobile) });
  const url = normalizeText(
    realtimeClient.url || (mobileConfig.enabled === true && mobile?.adapter?.available === true ? mobileConfig.apiBaseUrl : "")
  );
  const options = normalizeObject(realtimeClient.options);
  const explicitDebugEnabled =
    typeof realtimeClient.debug === "boolean"
      ? realtimeClient.debug
      : typeof realtime.debug === "boolean"
        ? realtime.debug
        : undefined;
  const hasRealtimeDebugEnvOverride = Object.hasOwn(normalizeObject(env), "VITE_REALTIME_DEBUG");
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

  return Object.freeze({ url, options, debugEnabled });
}

function createRealtimeClient({ config, loggerInput } = {}) {
  const logger = createProviderLogger(loggerInput, {
    debugEnabled: config.debugEnabled
  });
  const socket = createSocketIoClient({
    url: config.url,
    options: config.options
  });
  const detach = [];
  let initialized = false;

  function initialize(vueApp = null) {
    if (initialized) {
      return;
    }
    initialized = true;

    if (typeof socket.on === "function") {
      const onConnect = () => logger.debug({ socketConnected: true }, "Realtime client socket connected.");
      const onDisconnect = (reason) =>
        logger.debug(
          { socketConnected: false, reason: String(reason || "") },
          "Realtime client socket disconnected."
        );
      const onConnectError = (error) =>
        logger.warn(
          { error: String(error?.message || error || "unknown error") },
          "Realtime client socket connect error."
        );

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onConnectError);
      detach.push(() => {
        socket.off?.("connect", onConnect);
        socket.off?.("disconnect", onDisconnect);
        socket.off?.("connect_error", onConnectError);
      });

      if (config.debugEnabled === true && typeof socket.onAny === "function") {
        const onAny = (eventName, payload) =>
          logger.debug(
            {
              event: String(eventName || ""),
              payloadScope: payload?.scope || null,
              payloadEntityId: payload?.entityId || null
            },
            "Realtime client received socket event."
          );
        socket.onAny(onAny);
        detach.push(() => socket.offAny?.(onAny));
      }
    }

    vueApp?.provide?.("jskit.realtime.runtime.client.socket", socket);
  }

  function dispose() {
    for (const release of detach.splice(0, detach.length)) {
      try {
        release();
      } catch {}
    }
    disconnectSocketIoClient(socket);
    initialized = false;
  }

  return Object.freeze({
    ...REALTIME_RUNTIME_CLIENT_API,
    config,
    dispose,
    initialize,
    socket
  });
}

const RealtimeClientProvider = defineProvider({
  id: "runtime.realtime.client",
  requires: {
    components: "client.components",
    env: "client.env",
    logger: "client.logger",
    vueApp: "client.vue"
  },
  optional: {
    mobile: "client.mobile"
  },
  provides: {
    realtime: "client.realtime"
  },
  setup({ components, env, logger, mobile }) {
    components.register("realtime.web.connection.indicator", RealtimeConnectionIndicator);
    return {
      realtime: createRealtimeClient({
        config: resolveRealtimeClientConfig({ env, mobile }),
        loggerInput: logger
      })
    };
  },
  boot({ vueApp }, { outputs }) {
    outputs.realtime.initialize(vueApp);
  },
  shutdown(_dependencies, { outputs }) {
    outputs.realtime.dispose();
  }
});

export { RealtimeClientProvider, resolveRealtimeClientConfig };
