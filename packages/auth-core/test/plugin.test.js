import assert from "node:assert/strict";
import test from "node:test";
import { createFakeFastifyPolicyRuntime } from "../../../tooling/testUtils/fakeFastify.mjs";

import { authPolicyPlugin } from "../src/server/lib/index.js";

test("requires resolveActor and hasPermission dependencies", () => {
  assert.throws(() => authPolicyPlugin(), /resolveActor is required/);
  assert.throws(() => authPolicyPlugin({ resolveActor() {} }), /hasPermission is required/);
});

test("resolves csrf token headers and skips auth for non-api/public routes", async () => {
  let actorCalls = 0;
  const { fastify, state } = createFakeFastifyPolicyRuntime();
  const registerPlugin = authPolicyPlugin(
    {
      async resolveActor() {
        actorCalls += 1;
        return {
          authenticated: false,
          actor: null,
          transientFailure: false
        };
      },
      hasPermission() {
        return true;
      }
    },
    {
      nodeEnv: "test"
    }
  );

  await registerPlugin(fastify);
  assert.ok(state.preHandler);
  assert.ok(state.csrfOptions);
  const getToken = state.csrfOptions.getToken;
  assert.equal(getToken({ headers: { "csrf-token": "a" } }), "a");
  assert.equal(getToken({ headers: { "x-csrf-token": "b" } }), "b");
  assert.equal(getToken({ headers: { "x-xsrf-token": "c" } }), "c");
  assert.equal(getToken({ headers: {} }), null);

  await state.preHandler({ method: "GET", raw: { url: "/health" }, routeOptions: {} }, {});
  await state.preHandler(
    {
      method: "GET",
      raw: { url: "/api/public" },
      routeOptions: {
        config: {
          authPolicy: "public"
        }
      }
    },
    {}
  );
  assert.equal(actorCalls, 0);
});

test("propagates csrf callback error", async () => {
  const { fastify, state } = createFakeFastifyPolicyRuntime({
    csrfHandler(_request, _reply, done) {
      done(new Error("csrf callback failed"));
    }
  });

  const registerPlugin = authPolicyPlugin({
    async resolveActor() {
      return {
        authenticated: false,
        actor: null,
        transientFailure: false
      };
    },
    hasPermission() {
      return true;
    }
  });

  await registerPlugin(fastify);
  await assert.rejects(
    () =>
      state.preHandler(
        {
          method: "POST",
          raw: { url: "/api/public-action" },
          routeOptions: {
            config: {
              authPolicy: "public"
            }
          },
          headers: {}
        },
        {}
      ),
    /csrf callback failed/
  );
});

test("enforces own policy owner checks and invalid policy guard", async () => {
  const denyEvents = [];
  const { fastify, state } = createFakeFastifyPolicyRuntime();
  const registerPlugin = authPolicyPlugin({
    async resolveActor(request) {
      if (request.headers?.["x-profile"] === "null") {
        return {
          authenticated: true,
          actor: null,
          transientFailure: false
        };
      }

      return {
        authenticated: true,
        actor: {
          id: 7
        },
        transientFailure: false
      };
    },
    hasPermission() {
      return true;
    },
    onPolicyDenied(event) {
      denyEvents.push(event);
    }
  });

  await registerPlugin(fastify);

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
              ownerResolver({ user }) {
                assert.equal(user, null);
                return 1;
              }
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
          raw: { url: "/api/own-b" },
          headers: {},
          params: { id: 99 },
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
    /Forbidden/
  );

  await assert.rejects(
    () =>
      state.preHandler(
        {
          method: "GET",
          raw: { url: "/api/bad-policy" },
          headers: {},
          routeOptions: {
            config: {
              authPolicy: "unknown-policy"
            }
          }
        },
        {}
      ),
    /Invalid route auth policy configuration/
  );

  assert.deepEqual(
    denyEvents.map((event) => event.reason),
    ["owner_unresolved", "forbidden_owner_mismatch", "invalid_auth_policy"]
  );
});

test("enforces permission checks and resolves workspace context when requested", async () => {
  const denyEvents = [];
  const { fastify, state } = createFakeFastifyPolicyRuntime();
  const registerPlugin = authPolicyPlugin({
    async resolveActor() {
      return {
        authenticated: true,
        actor: {
          id: 7
        },
        transientFailure: false
      };
    },
    async resolveContext() {
      return {
        workspace: {
          id: 11
        },
        membership: {
          roleId: "member"
        },
        permissions: []
      };
    },
    hasPermission({ permission, permissions }) {
      return Array.isArray(permissions) && permissions.includes(permission);
    },
    onPolicyDenied(event) {
      denyEvents.push(event);
    }
  });

  await registerPlugin(fastify);
  await assert.rejects(
    () =>
      state.preHandler(
        {
          method: "GET",
          raw: { url: "/api/workspace/projects" },
          routeOptions: {
            config: {
              authPolicy: "required",
              contextPolicy: "required",
              permission: "projects.read"
            }
          }
        },
        {}
      ),
    /Forbidden/
  );

  assert.deepEqual(denyEvents.map((event) => event.reason), ["forbidden_permission"]);
});
