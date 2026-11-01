// csrfProtection's default in the fake: every request passes.
function passCsrfProtection(_request, _reply, done) {
  done();
}

/**
 * A Fastify stand-in for policy plugin tests. It records the plugins
 * registered (and the CSRF plugin's options), the request decorators and the
 * preHandler hook, and runs csrfProtection through `csrfHandler`.
 * @param {object} [options]
 * @param {(request: unknown, reply: unknown, done: (error?: Error) => void) => void} [options.csrfHandler]
 */
function createFakeFastifyPolicyRuntime({ csrfHandler = passCsrfProtection } = {}) {
  const state = {
    csrfOptions: null,
    preHandler: null,
    registeredPlugins: [],
    requestDecorators: new Set()
  };

  const fastify = {
    async register(plugin, options) {
      state.registeredPlugins.push({
        plugin,
        options
      });

      // readable-check: allow method-probe - data: the CSRF plugin's registration is the one whose options carry getToken
      if (options && typeof options.getToken === "function") {
        state.csrfOptions = options;
      }
    },
    decorateRequest(name) {
      state.requestDecorators.add(name);
    },
    addHook(name, handler) {
      if (name === "preHandler") {
        state.preHandler = handler;
      }
    },
    csrfProtection(request, reply, done) {
      csrfHandler(request, reply, done);
    }
  };

  return {
    fastify,
    state
  };
}

export { createFakeFastifyPolicyRuntime };
