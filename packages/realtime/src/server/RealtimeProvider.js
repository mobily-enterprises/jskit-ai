import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createRealtimeDelivery } from "./realtimeDelivery.js";
import {
  createAudienceContributors,
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

// The kernel's code for this English, so a client can show it in the user's language.
function authenticationRequiredError() {
  return Object.assign(new Error("Authentication required."), { statusCode: 401, code: "AUTHENTICATION_REQUIRED" });
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
            socket, request, authService: state.authService, audiences: state.audiences
          });
          if (!socket.connected || (!actor && realtimeAuthenticationRequired(state.authService))) {
            throw authenticationRequiredError();
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
              if (!request.user) throw authenticationRequiredError();
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
    // A package that knows which scopes (kind "user", "workspace" or
    // "workspace_user") an actor belongs to registers them during setup; sockets
    // join, and on revalidation leave, exactly the rooms its scopes name.
    registerAudienceContributor(contributor) {
      const state = stateByCapability.get(capability);
      if (!state) throw new Error("Realtime runtime state is unavailable.");
      state.audiences.register(contributor);
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
    database: "runtime.database"
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
      audiences: createAudienceContributors(),
      authService: null,
      connectionListeners: new Set(),
      delivery: null,
      io,
      providerLogger,
      redisConnection: null
    });
    return { realtime };
  },
  async boot({ authService, database, env, events }, { outputs }) {
    const state = stateByCapability.get(outputs.realtime);
    if (!state) throw new Error("Realtime runtime state is unavailable.");
    state.authService = authService;
    state.delivery = createRealtimeDelivery({
      io: state.io, database, logger: state.providerLogger, authService, audiences: state.audiences
    });
    state.authenticationRequired = realtimeAuthenticationRequired(authService);
    registerSocketAudienceBootstrap({
      io: state.io,
      logger: state.providerLogger,
      authService,
      audiences: state.audiences
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
