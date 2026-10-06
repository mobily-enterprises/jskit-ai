import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createRealtimeDelivery } from "./realtimeDelivery.js";
import {
  createSocketRequest,
  realtimeAuthenticationRequired,
  registerSocketAudienceBootstrap,
  revalidateSocket
} from "./realtimeAudience.js";
import {
  closeSocketIoRedisConnections,
  closeSocketIoServer,
  configureSocketIoRedisAdapter,
  createSocketIoServer,
  resolveRealtimeRedisNamespace,
  resolveRealtimeRedisUrl
} from "./runtime.js";

const stateByCapability = new WeakMap();

function parseDebugFlag(value, fallback = null) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function debugEnabled(config, env) {
  return parseDebugFlag(env?.JSKIT_REALTIME_DEBUG, parseDebugFlag(config?.realtime?.debug, false));
}

function createRealtimeCapability({ io }) {
  const capability = Object.freeze({
    onConnection(listener) {
      if (typeof listener !== "function") throw new TypeError("Realtime connection listener must be a function.");
      const state = stateByCapability.get(capability);
      if (!state) throw new Error("Realtime runtime state is unavailable.");
      const releases = new Map();
      function attach(socket) {
        if (releases.has(socket)) return;
        let detach;
        async function readRequest() {
          const request = createSocketRequest(socket);
          const actor = await revalidateSocket({
            socket, request, authService: state.authService, workspaces: state.workspaces
          });
          if (!socket.connected || (!actor && realtimeAuthenticationRequired(state.authService))) {
            throw Object.assign(new Error("Authentication required."), { statusCode: 401 });
          }
          if (actor) request.user = actor;
          return request;
        }
        function release() {
          socket.off("disconnect", release);
          releases.delete(socket);
          try { detach?.(); }
          catch (error) {
            state.providerLogger.warn({ error: String(error?.message || error) }, "Realtime connection cleanup failed.");
          }
        }
        try {
          detach = listener({
            socket,
            // Hosts authorize this real connection request through their own
            // action boundary. Reading it alone does not grant local access.
            readRequest,
            async authenticate() {
              const request = await readRequest();
              if (!request.user) throw Object.assign(new Error("Authentication required."), { statusCode: 401 });
              return request;
            }
          });
          if (detach != null && typeof detach !== "function") {
            throw new TypeError("Realtime connection listeners must return a cleanup function or undefined.");
          }
          releases.set(socket, release);
          socket.on("disconnect", release);
        } catch (error) {
          state.providerLogger.warn({ error: String(error?.message || error) }, "Realtime connection listener failed.");
        }
      }
      function stop() {
        io.off("connection", attach);
        for (const release of [...releases.values()]) release();
        state.connectionListeners.delete(stop);
      }
      state.connectionListeners.add(stop);
      io.on("connection", attach);
      for (const socket of io.sockets.sockets.values()) attach(socket);
      return stop;
    },
    diagnostics() {
      const state = stateByCapability.get(capability);
      return Object.freeze({
        authenticationRequired: state?.authenticationRequired === true,
        connectedClients: Number.isInteger(Number(io?.engine?.clientsCount))
          ? Number(io.engine.clientsCount)
          : null,
        redisConfigured: state?.redisConnection?.enabled === true
      });
    }
  });
  return capability;
}

const RealtimeProvider = defineProvider({
  id: "runtime.realtime",
  requires: {
    config: "runtime.config",
    env: "runtime.env",
    events: "runtime.events",
    fastify: "runtime.fastify",
    logger: "runtime.logger"
  },
  optional: {
    authService: "auth.service",
    database: "runtime.database",
    workspaces: "workspaces.core"
  },
  provides: {
    realtime: "runtime.realtime"
  },
  setup({ config, env, fastify, logger }) {
    const io = createSocketIoServer({ fastify });
    const providerLogger = createProviderLogger(logger, { debugEnabled: debugEnabled(config, env) });
    const realtime = createRealtimeCapability({ io });
    stateByCapability.set(realtime, {
      authenticationRequired: false,
      authService: null,
      workspaces: null,
      connectionListeners: new Set(),
      delivery: null,
      io,
      providerLogger,
      redisConnection: null
    });
    return { realtime };
  },
  async boot({ authService, database, env, events, workspaces }, { outputs }) {
    const state = stateByCapability.get(outputs.realtime);
    if (!state) throw new Error("Realtime runtime state is unavailable.");
    state.authService = authService;
    state.workspaces = workspaces;
    state.delivery = createRealtimeDelivery({
      io: state.io, database, logger: state.providerLogger, authService, workspaces
    });
    state.authenticationRequired = realtimeAuthenticationRequired(authService);
    registerSocketAudienceBootstrap({
      io: state.io,
      logger: state.providerLogger,
      authService,
      workspaces
    });
    state.redisConnection = await configureSocketIoRedisAdapter(state.io, {
      logger: state.providerLogger,
      redisUrl: resolveRealtimeRedisUrl(env),
      redisNamespace: resolveRealtimeRedisNamespace(env)
    });
    state.delivery.start({ redisConfigured: state.redisConnection.enabled });
    events.register({
      id: "runtime.realtime.delivery",
      matches: (event) => Boolean(normalizeText(event?.realtime?.event)),
      handle: state.delivery.handle
    });
  },
  async shutdown(_dependencies, { outputs }) {
    const state = stateByCapability.get(outputs.realtime);
    if (!state) return;
    for (const release of [...state.connectionListeners]) release();
    state.delivery?.stop();
    await closeSocketIoServer(state.io);
    await closeSocketIoRedisConnections(state.redisConnection || {});
    stateByCapability.delete(outputs.realtime);
  }
});

export { RealtimeProvider };
