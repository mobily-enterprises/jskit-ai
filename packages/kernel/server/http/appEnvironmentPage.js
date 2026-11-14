import { appEnvironment, withAppEnvironmentMeta } from "../../shared/support/appEnvironment.js";

/** @typedef {import("../types.js").RuntimeEnv} RuntimeEnv */
/** @typedef {import("../types.js").RuntimeFastify} RuntimeFastify */

const HTML_CONTENT_TYPE = /^text\/html\b/iu;

/**
 * Names the application's environment (APP_ENV) in every HTML page the server
 * sends, as the `jskit-app-environment` meta tag, so the shell shows its
 * "Development", "Test" or "Staging" banner from the page itself. A page sent as
 * a stream (a file the server pipes) goes unchanged. Register it before any
 * plugin, so every route inherits it; `createInstalledRuntime` does.
 * @param {RuntimeFastify} fastify
 * @param {{ env: RuntimeEnv }} settings
 */
function registerAppEnvironmentPage(fastify, { env }) {
  const environment = appEnvironment(env);
  fastify.addHook("onSend", async (request, reply, payload) => {
    if (!HTML_CONTENT_TYPE.test(String(reply.getHeader("content-type") || ""))) {
      return payload;
    }
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) {
      return payload;
    }
    // Fastify measures the page again when no length was set, so a length the route set for the page without the
    // tag goes.
    reply.removeHeader("content-length");
    const page = withAppEnvironmentMeta(String(payload), environment);
    return typeof payload === "string" ? page : Buffer.from(page, "utf8");
  });
}

export { registerAppEnvironmentPage };
