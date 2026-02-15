import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import authPlugin from "../plugins/auth.js";

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
