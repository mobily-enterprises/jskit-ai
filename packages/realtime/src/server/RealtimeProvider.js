import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { createRealtimeCapability } from "./realtimeCapability.js";
import {
  createSocketIoServer,
  resolveRealtimeRedisNamespace,
  resolveRealtimeRedisUrl
} from "./runtime.js";

function parseDebugFlag(value, fallback) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function debugEnabled(config, env) {
  return parseDebugFlag(env.JSKIT_REALTIME_DEBUG, parseDebugFlag(config.realtime?.debug, false));
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
    audienceScope: "realtime.audience-scope",
    authService: "auth.service"
  },
  provides: {
    realtime: "runtime.realtime"
  },
  /**
   * @param {object} dependencies
   * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot | null} dependencies.appRoot
   * @param {import("./types.js").RealtimeAudienceScope | null} dependencies.audienceScope The contexts
   *   audiences read in, from RealtimeAudienceScopeFeature when the application registers it.
   * @param {import("@jskit-ai/auth-core/server/types").AuthService | null} dependencies.authService
   * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} dependencies.config
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEvents} dependencies.events
   * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} dependencies.fastify
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
   */
  setup({ appRoot, audienceScope, authService, config, env, events, fastify, logger }) {
    const realtime = createRealtimeCapability({
      io: createSocketIoServer({ fastify }),
      logger: createProviderLogger(logger, { debugEnabled: debugEnabled(config, env) }),
      authService,
      events,
      appRoot,
      audienceScope,
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
