import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import authPlugin from "../server/fastify/auth.plugin.js";

function installTestErrorHandler(app) {
  app.setErrorHandler((error, _request, reply) => {
    const status = Number(error.statusCode || error.status || 500);
    reply.code(status).send({
      error: String(error.message || "Request failed."),
      statusCode: status
    });
  });
}

async function createApp(authService, routeConfig) {
  const app = Fastify();
  installTestErrorHandler(app);
  await app.register(authPlugin, { authService, nodeEnv: "test" });

  app.get("/api/protected/:id", {
    config: routeConfig || { authPolicy: "required" },
    async handler(request) {
      return {
        ok: true,
        userId: request.user ? request.user.id : null,
        paramId: request.params.id
      };
    }
  });

  return app;
}

test("required policy returns stable 401 contract when unauthenticated", async () => {
  const app = await createApp({
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
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/protected/abc"
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.payload), {
    error: "Authentication required.",
    statusCode: 401
  });
  await app.close();
});

test("required policy injects request.user", async () => {
  const app = await createApp({
    async authenticateRequest() {
      return {
        authenticated: true,
        profile: {
          id: 7
        },
        clearSession: false,
        session: null,
        transientFailure: false
      };
    },
    writeSessionCookies() {},
    clearSessionCookies() {}
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/protected/xyz"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.payload), {
    ok: true,
    userId: 7,
    paramId: "xyz"
  });
  await app.close();
});

test("own policy returns stable 403 contract when owner does not match", async () => {
  const app = await createApp(
    {
      async authenticateRequest() {
        return {
          authenticated: true,
          profile: {
            id: 42
          },
          clearSession: false,
          session: null,
          transientFailure: false
        };
      },
      writeSessionCookies() {},
      clearSessionCookies() {}
    },
    {
      authPolicy: "own",
      ownerParam: "id",
      userField: "id"
    }
  );

  const response = await app.inject({
    method: "GET",
    url: "/api/protected/99"
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.payload), {
    error: "Forbidden.",
    statusCode: 403
  });
  await app.close();
});

test("csrf protection blocks missing token and accepts a valid token", async () => {
  const app = Fastify();
  installTestErrorHandler(app);
  await app.register(authPlugin, {
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

  app.get("/api/csrf-token", {
    config: {
      authPolicy: "public"
    },
    async handler(_request, reply) {
      return {
        csrfToken: await reply.generateCsrf()
      };
    }
  });

  app.post("/api/public-action", {
    config: {
      authPolicy: "public"
    },
    async handler() {
      return { ok: true };
    }
  });

  const blockedResponse = await app.inject({
    method: "POST",
    url: "/api/public-action",
    payload: {
      action: "demo"
    }
  });

  assert.equal(blockedResponse.statusCode, 403);
  assert.equal(JSON.parse(blockedResponse.payload).statusCode, 403);

  const tokenResponse = await app.inject({
    method: "GET",
    url: "/api/csrf-token"
  });

  assert.equal(tokenResponse.statusCode, 200);
  const tokenPayload = JSON.parse(tokenResponse.payload);
  const cookieHeader = tokenResponse.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

  const allowedResponse = await app.inject({
    method: "POST",
    url: "/api/public-action",
    headers: {
      "csrf-token": tokenPayload.csrfToken,
      cookie: cookieHeader
    },
    payload: {
      action: "demo"
    }
  });

  assert.equal(allowedResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(allowedResponse.payload), { ok: true });
  await app.close();
});

test("malformed URL path returns 400 instead of crashing", async () => {
  const app = Fastify();
  app.get("/api/echo/:id", async (request) => ({ id: request.params.id }));

  const response = await app.inject({
    method: "GET",
    url: "/api/echo/%E0%A4%A"
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});

test("plugin registration fails fast when authService is missing", async () => {
  const app = Fastify();
  app.register(authPlugin, { nodeEnv: "test" });
  await assert.rejects(() => app.ready(), /authService is required/);
  await app.close();
});

test("non-api routes bypass auth preHandler", async () => {
  let authCalls = 0;
  const app = Fastify();
  installTestErrorHandler(app);
  await app.register(authPlugin, {
    authService: {
      async authenticateRequest() {
        authCalls += 1;
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

  app.get("/health", async () => ({ ok: true }));

  const response = await app.inject({
    method: "GET",
    url: "/health"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(authCalls, 0);
  await app.close();
});

test("required auth policy propagates session cookie operations and transient failures", async () => {
  const sideEffects = [];
  const app = Fastify();
  installTestErrorHandler(app);
  await app.register(authPlugin, {
    authService: {
      async authenticateRequest(request) {
        if (request.headers["x-mode"] === "transient") {
          return {
            authenticated: false,
            clearSession: false,
            session: null,
            transientFailure: true
          };
        }

        return {
          authenticated: true,
          profile: { id: 12 },
          clearSession: true,
          session: { access_token: "a", refresh_token: "b", expires_in: 3600 },
          transientFailure: false
        };
      },
      writeSessionCookies() {
        sideEffects.push("write");
      },
      clearSessionCookies() {
        sideEffects.push("clear");
      }
    },
    nodeEnv: "test"
  });

  app.get(
    "/api/required",
    {
      config: { authPolicy: "required" }
    },
    async () => ({ ok: true })
  );

  const okResponse = await app.inject({
    method: "GET",
    url: "/api/required"
  });
  assert.equal(okResponse.statusCode, 200);
  assert.deepEqual(sideEffects, ["clear", "write"]);

  const transientResponse = await app.inject({
    method: "GET",
    url: "/api/required",
    headers: {
      "x-mode": "transient"
    }
  });
  assert.equal(transientResponse.statusCode, 503);
  assert.equal(
    JSON.parse(transientResponse.payload).error,
    "Authentication service temporarily unavailable. Please retry."
  );
  await app.close();
});

test("own auth policy supports ownerResolver, unresolved owners, and matching owners", async () => {
  const app = Fastify();
  installTestErrorHandler(app);
  await app.register(authPlugin, {
    authService: {
      async authenticateRequest() {
        return {
          authenticated: true,
          profile: { id: 42, tenantId: "tenant-1" },
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

  app.get(
    "/api/own/match/:id",
    {
      config: {
        authPolicy: "own",
        ownerResolver({ params }) {
          return params.id;
        }
      }
    },
    async () => ({ ok: true })
  );

  app.get(
    "/api/own/unresolved",
    {
      config: {
        authPolicy: "own"
      }
    },
    async () => ({ ok: true })
  );

  app.get(
    "/api/own/field/:tenantId",
    {
      config: {
        authPolicy: "own",
        ownerParam: "tenantId",
        userField: "tenantId"
      }
    },
    async () => ({ ok: true })
  );

  const matchResponse = await app.inject({
    method: "GET",
    url: "/api/own/match/42"
  });
  assert.equal(matchResponse.statusCode, 200);

  const unresolvedResponse = await app.inject({
    method: "GET",
    url: "/api/own/unresolved"
  });
  assert.equal(unresolvedResponse.statusCode, 400);
  assert.equal(JSON.parse(unresolvedResponse.payload).error, "Route owner could not be resolved.");

  const fieldResponse = await app.inject({
    method: "GET",
    url: "/api/own/field/tenant-1"
  });
  assert.equal(fieldResponse.statusCode, 200);
  await app.close();
});

test("invalid auth policy returns 500", async () => {
  const app = Fastify();
  installTestErrorHandler(app);
  await app.register(authPlugin, {
    authService: {
      async authenticateRequest() {
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

  app.get(
    "/api/bad-policy",
    {
      config: {
        authPolicy: "unknown-policy"
      }
    },
    async () => ({ ok: true })
  );

  const response = await app.inject({
    method: "GET",
    url: "/api/bad-policy"
  });
  assert.equal(response.statusCode, 500);
  assert.equal(JSON.parse(response.payload).error, "Invalid route auth policy configuration.");
  await app.close();
});

test("csrf protection accepts x-csrf-token and x-xsrf-token header variants", async () => {
  const app = Fastify();
  installTestErrorHandler(app);
  await app.register(authPlugin, {
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

  app.get("/api/token", { config: { authPolicy: "public" } }, async (_request, reply) => ({
    csrfToken: await reply.generateCsrf()
  }));
  app.post("/api/action", { config: { authPolicy: "public" } }, async () => ({ ok: true }));

  const tokenResponse = await app.inject({
    method: "GET",
    url: "/api/token"
  });
  const tokenPayload = JSON.parse(tokenResponse.payload);
  const cookieHeader = tokenResponse.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

  const xCsrf = await app.inject({
    method: "POST",
    url: "/api/action",
    headers: {
      "x-csrf-token": tokenPayload.csrfToken,
      cookie: cookieHeader
    }
  });
  assert.equal(xCsrf.statusCode, 200);

  const xXsrf = await app.inject({
    method: "POST",
    url: "/api/action",
    headers: {
      "x-xsrf-token": tokenPayload.csrfToken,
      cookie: cookieHeader
    }
  });
  assert.equal(xXsrf.statusCode, 200);
  await app.close();
});

test("csrf protection can be disabled per route", async () => {
  const app = Fastify();
  installTestErrorHandler(app);
  await app.register(authPlugin, {
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

  app.post(
    "/api/no-csrf",
    {
      config: {
        authPolicy: "public",
        csrfProtection: false
      }
    },
    async () => ({ ok: true })
  );

  const response = await app.inject({
    method: "POST",
    url: "/api/no-csrf"
  });
  assert.equal(response.statusCode, 200);
  await app.close();
});

test("auth plugin emits auth failure observability events", async () => {
  const authFailures = [];
  const app = Fastify();
  installTestErrorHandler(app);
  await app.register(authPlugin, {
    authService: {
      async authenticateRequest(request) {
        if (request.headers["x-mode"] === "transient") {
          return {
            authenticated: false,
            clearSession: false,
            session: null,
            transientFailure: true
          };
        }

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
    observabilityService: {
      recordAuthFailure(event) {
        authFailures.push(event);
      }
    },
    nodeEnv: "test"
  });

  app.get(
    "/api/protected",
    {
      config: { authPolicy: "required" }
    },
    async () => ({ ok: true })
  );

  const unauthenticated = await app.inject({
    method: "GET",
    url: "/api/protected"
  });
  assert.equal(unauthenticated.statusCode, 401);

  const transient = await app.inject({
    method: "GET",
    url: "/api/protected",
    headers: {
      "x-mode": "transient"
    }
  });
  assert.equal(transient.statusCode, 503);

  assert.deepEqual(authFailures, [
    {
      reason: "unauthenticated",
      surface: "app"
    },
    {
      reason: "auth_upstream_unavailable",
      surface: "app"
    }
  ]);

  await app.close();
});
