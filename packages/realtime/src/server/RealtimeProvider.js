import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createRealtimeDelivery } from "./realtimeDelivery.js";
import {
  realtimeAuthenticationRequired,
  registerSocketAudienceBootstrap
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
    state.delivery?.stop();
    await closeSocketIoServer(state.io);
    await closeSocketIoRedisConnections(state.redisConnection || {});
    stateByCapability.delete(outputs.realtime);
  }
});

export { RealtimeProvider };
