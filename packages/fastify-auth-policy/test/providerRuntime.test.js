import assert from "node:assert/strict";
import test from "node:test";
import { TOKENS } from "@jskit-ai/support-core/tokens";
import { FastifyAuthPolicyServiceProvider } from "../src/server/providers/FastifyAuthPolicyServiceProvider.js";

function createFakeFastify() {
  const state = {
    registeredPlugins: [],
    preHandler: null,
    requestDecorators: new Set()
  };

  const fastify = {
    async register(plugin, options) {
      state.registeredPlugins.push({
        plugin,
        options
      });
      // Emulate Fastify behavior for the provider-registered plugin only.
      if (state.registeredPlugins.length === 1 && typeof plugin === "function") {
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
    csrfProtection(_request, _reply, done) {
      done();
    }
  };

  return {
    fastify,
    state
  };
}

test("FastifyAuthPolicyServiceProvider registers auth policy plugin through provider boot", async () => {
  const { fastify, state } = createFakeFastify();
  const bag = new Map([
    [TOKENS.Fastify, fastify],
    [TOKENS.Env, { NODE_ENV: "test" }],
    [TOKENS.Logger, console],
    [
      "authService",
      {
        async authenticateRequest() {
          return {
            authenticated: false,
            actor: null,
            transientFailure: false
          };
        }
      }
    ]
  ]);

  const app = {
    has(token) {
      return bag.has(token);
    },
    make(token) {
      if (!bag.has(token)) {
        throw new Error(`Missing token ${String(token)}`);
      }
      return bag.get(token);
    }
  };

  const provider = new FastifyAuthPolicyServiceProvider();
  provider.register(app);
  await provider.boot(app);

  assert.ok(state.requestDecorators.has("user"));
  assert.ok(state.requestDecorators.has("workspace"));
  assert.ok(state.requestDecorators.has("membership"));
  assert.ok(state.requestDecorators.has("permissions"));
  assert.equal(typeof state.preHandler, "function");
  assert.ok(state.registeredPlugins.length >= 3);
});
