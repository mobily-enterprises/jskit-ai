import assert from "node:assert/strict";
import test from "node:test";
import authPlugin from "../server/fastify/auth.plugin.js";
import { AppError } from "../server/lib/errors.js";

function createFakeFastify({ csrfHandler } = {}) {
  const state = {
    csrfOptions: null,
    preHandler: null
  };

  const fastify = {
    async register(_plugin, options) {
      if (options && typeof options.getToken === "function") {
        state.csrfOptions = options;
      }
    },
    decorateRequest() {},
    addHook(name, hook) {
      if (name === "preHandler") {
        state.preHandler = hook;
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

  return { fastify, state };
}

const plugin = authPlugin.default || authPlugin;

test("auth plugin internal branches: token resolution and /api guard fallbacks", async () => {
  let authCalls = 0;
  const { fastify, state } = createFakeFastify();
  await plugin(fastify, {
    authService: {
      async authenticateRequest() {
        authCalls += 1;
        return {
          authenticated: true,
          profile: { id: 1 },
          clearSession: false,
          session: null,
          transientFailure: false
        };
      },
      writeSessionCookies() {},
      clearSessionCookies() {}
    },
    nodeEnv: "test"
  });

  assert.ok(state.csrfOptions);
  const getToken = state.csrfOptions.getToken;
  assert.equal(getToken({ headers: { "csrf-token": "a" } }), "a");
  assert.equal(getToken({ headers: { "x-csrf-token": "b" } }), "b");
  assert.equal(getToken({ headers: { "x-xsrf-token": "c" } }), "c");
  assert.equal(getToken({ headers: {} }), null);

  await state.preHandler({ method: "GET", raw: {}, url: undefined }, {});
  await state.preHandler({ method: "GET", raw: {}, url: "/api/public", routeOptions: {} }, {});
  assert.equal(authCalls, 0);
});

test("auth plugin internal branch: csrf callback error is propagated", async () => {
  const { fastify, state } = createFakeFastify({
    csrfHandler(_request, _reply, done) {
      done(new Error("csrf callback failed"));
    }
  });
  await plugin(fastify, {
    authService: {
      async authenticateRequest() {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: false
        };
      },
      writeSessionCookies() {},
      clearSessionCookies() {}
    },
    nodeEnv: "test"
  });

  await assert.rejects(
    () =>
      state.preHandler(
        {
          method: "POST",
          raw: { url: "/api/public-action" },
          routeOptions: { config: { authPolicy: "public" } },
          headers: {}
        },
        {}
      ),
    /csrf callback failed/
  );
});

test("auth plugin internal branches: own policy resolver nulls and ownerParam type mismatch", async () => {
  const { fastify, state } = createFakeFastify();
  await plugin(fastify, {
    authService: {
      async authenticateRequest(request) {
        if (request.headers?.["x-profile"] === "null") {
          return {
            authenticated: true,
            profile: null,
            clearSession: false,
            session: null,
            transientFailure: false
          };
        }
        return {
          authenticated: true,
          profile: { id: 7 },
          clearSession: false,
          session: null,
          transientFailure: false
        };
      },
      writeSessionCookies() {},
      clearSessionCookies() {}
    },
    nodeEnv: "test"
  });

  await assert.rejects(
    () =>
      state.preHandler(
        {
          method: "GET",
          raw: { url: "/api/own-a" },
          headers: { "x-profile": "null" },
          routeOptions: {
            config: {
              authPolicy: "own",
              ownerResolver({ params, user }) {
                assert.deepEqual(params, {});
                assert.equal(user, null);
                return 1;
              }
            }
          }
        },
        {}
      ),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      return true;
    }
  );

  await assert.rejects(
    () =>
      state.preHandler(
        {
          method: "GET",
          raw: { url: "/api/own-b" },
          headers: {},
          params: { id: 7 },
          routeOptions: {
            config: {
              authPolicy: "own",
              ownerParam: 123,
              userField: "id"
            }
          }
        },
        {}
      ),
    /Route owner could not be resolved/
  );

  await assert.rejects(
    () =>
      state.preHandler(
        {
          method: "GET",
          raw: { url: "/api/own-c" },
          headers: {},
          routeOptions: {
            config: {
              authPolicy: "own",
              ownerParam: "id",
              userField: "id"
            }
          }
        },
        {}
      ),
    /Route owner could not be resolved/
  );
});
