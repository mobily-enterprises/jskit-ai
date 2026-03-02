function createFakeFastifyPolicyRuntime({ csrfHandler, autoRunPlugin = null } = {}) {
  const state = {
    csrfOptions: null,
    preHandler: null,
    registeredPlugins: [],
    requestDecorators: new Set(),
    pluginRunCount: 0
  };

  const fastify = {
    async register(plugin, options) {
      state.registeredPlugins.push({
        plugin,
        options
      });

      if (options && typeof options.getToken === "function") {
        state.csrfOptions = options;
      }

      const shouldRunPlugin =
        typeof autoRunPlugin === "function"
          ? Boolean(autoRunPlugin({ plugin, options, state }))
          : autoRunPlugin === true;

      if (shouldRunPlugin && typeof plugin === "function") {
        state.pluginRunCount += 1;
        await plugin(fastify, options);
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
      if (typeof csrfHandler === "function") {
        csrfHandler(request, reply, done);
        return;
      }
      done();
    }
  };

  return {
    fastify,
    state
  };
}

export { createFakeFastifyPolicyRuntime };
