import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createRealtimeDelivery } from "./realtimeDelivery.js";
import { announceServedClientBuild } from "./servedClientBuild.js";
import {
  createAudienceContributors,
  realtimeAuthenticationRequired,
  registerSocketAudienceBootstrap
} from "./realtimeAudience.js";
import { createRealtimeCapability, stateByCapability } from "./realtimeCapability.js";
import {
  closeSocketIoRedisConnections,
  closeSocketIoServer,
  configureSocketIoRedisAdapter,
  createSocketIoServer,
  resolveRealtimeRedisNamespace,
  resolveRealtimeRedisUrl
} from "./runtime.js";

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
    appRoot: "runtime.app-root",
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
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} [capabilities.appRoot]
   * @param {import("./realtimeAudience.js").AuthService} [capabilities.authService]
   * @param {import("./realtimeAudience.js").RuntimeDatabase} [capabilities.database]
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEvents} capabilities.events
   */
  async boot({ appRoot, authService, database, env, events }, { outputs }) {
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
    announceServedClientBuild({ io: state.io, appRoot, logger: state.providerLogger });
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
