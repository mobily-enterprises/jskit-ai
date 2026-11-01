import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createRealtimeCapability } from "./realtimeCapability.js";
import { createRealtimeLogger } from "./realtimeLogger.js";
import {
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
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot | null} capabilities.appRoot
   * @param {import("@jskit-ai/auth-core/server/types").AuthService | null} capabilities.authService
   * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} capabilities.config
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase | null} capabilities.database
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEvents} capabilities.events
   * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} capabilities.fastify
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} capabilities.logger
   */
  setup({ appRoot, authService, config, database, env, events, fastify, logger }) {
    const realtime = createRealtimeCapability({
      io: createSocketIoServer({ fastify }),
      logger: createRealtimeLogger({ logger, debugEnabled: debugEnabled(config, env) }),
      authService,
      database,
      events,
      appRoot,
      redis: { redisUrl: resolveRealtimeRedisUrl(env), redisNamespace: resolveRealtimeRedisNamespace(env) }
    });
    return { realtime };
  },
  /**
   * @param {unknown} _capabilities
   * @param {{ outputs: { realtime: import("./types.js").RuntimeRealtime } }} lifecycle
   */
  async boot(_capabilities, { outputs }) {
    await outputs.realtime.start();
  },
  /**
   * @param {unknown} _capabilities
   * @param {{ outputs: { realtime: import("./types.js").RuntimeRealtime } }} lifecycle
   */
  async shutdown(_capabilities, { outputs }) {
    await outputs.realtime.stop();
  }
});

export { RealtimeProvider };
