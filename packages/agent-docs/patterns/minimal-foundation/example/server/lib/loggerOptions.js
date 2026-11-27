import pino from "pino";

/**
 * The Fastify logger's options: the level LOG_LEVEL names, info without one (`jskit test` and the browser test servers
 * set warn, so a test server does not log every request), and, since Fastify's logger serializes only the `err` key,
 * the same serializer under `error`, which keeps the message and stack of `logger.error({ error }, "...")`.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} runtimeEnv
 */
function buildLoggerOptions(runtimeEnv) {
  return {
    level: String(runtimeEnv.LOG_LEVEL || "").trim() || "info",
    serializers: {
      error: pino.stdSerializers.err
    }
  };
}

export { buildLoggerOptions };
