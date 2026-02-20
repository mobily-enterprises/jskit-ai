import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import authPlugin from "../server/fastify/auth.plugin.js";
import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";
import { buildRoutes as buildAiRoutes } from "../server/modules/ai/routes.js";

function installErrorHandler(app) {
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = Number(error?.status || error?.statusCode || 500);
    reply.code(statusCode).send({
      error: String(error?.message || "Request failed."),
      statusCode
    });
  });
}

function createMissingHandler() {
  return async (_request, reply) => {
    reply.code(501).send({
      error: "missing"
    });
  };
}

async function issueCsrfToken(app) {
  const tokenResponse = await app.inject({
    method: "GET",
    url: "/api/csrf-token"
  });

  const tokenPayload = JSON.parse(tokenResponse.payload);
  const cookieHeader = tokenResponse.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

  return {
    token: tokenPayload.csrfToken,
    cookieHeader
  };
}

test("ai route rejects unauthenticated requests", async () => {
  const app = Fastify();
  installErrorHandler(app);

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
    workspaceService: {
      async resolveRequestContext() {
        return {
          workspace: null,
          membership: null,
          permissions: []
        };
      }
    },
    nodeEnv: "test"
  });

  app.get(
    "/api/csrf-token",
    {
      config: {
        authPolicy: "public"
      }
    },
    async (_request, reply) => ({
      csrfToken: await reply.generateCsrf()
    })
  );

  const controllers = {
    ai: {
      async chatStream(_request, reply) {
        reply.code(200).send({
          ok: true
        });
      }
    }
  };

  registerApiRoutes(app, {
    controllers,
    routes: buildAiRoutes(controllers, {
      missingHandler: createMissingHandler()
    })
  });

  const { token, cookieHeader } = await issueCsrfToken(app);
  const response = await app.inject({
    method: "POST",
    url: "/api/workspace/ai/chat/stream",
    headers: {
      "csrf-token": token,
      cookie: cookieHeader
    },
    payload: {
      messageId: "msg_auth_1",
      input: "hello"
    }
  });

  assert.equal(response.statusCode, 401);
  await app.close();
});

test("ai route enforces required permission in auth pre-handler", async () => {
  const app = Fastify();
  installErrorHandler(app);
  let handlerCalled = false;

  await app.register(authPlugin, {
    authService: {
      async authenticateRequest() {
        return {
          authenticated: true,
          clearSession: false,
          session: null,
          transientFailure: false,
          profile: {
            id: 7,
            email: "user@example.com"
          }
        };
      },
      writeSessionCookies() {},
      clearSessionCookies() {}
    },
    workspaceService: {
      async resolveRequestContext() {
        return {
          workspace: {
            id: 11,
            slug: "acme"
          },
          membership: {
            roleId: "member",
            status: "active"
          },
          permissions: []
        };
      }
    },
    nodeEnv: "test"
  });

  app.get(
    "/api/csrf-token",
    {
      config: {
        authPolicy: "public"
      }
    },
    async (_request, reply) => ({
      csrfToken: await reply.generateCsrf()
    })
  );

  const controllers = {
    ai: {
      async chatStream(_request, reply) {
        handlerCalled = true;
        reply.code(200).send({
          ok: true
        });
      }
    }
  };

  registerApiRoutes(app, {
    controllers,
    routes: buildAiRoutes(controllers, {
      missingHandler: createMissingHandler(),
      aiEnabled: true,
      aiRequiredPermission: "workspace.ai.use"
    })
  });

  const { token, cookieHeader } = await issueCsrfToken(app);
  const response = await app.inject({
    method: "POST",
    url: "/api/workspace/ai/chat/stream",
    headers: {
      "csrf-token": token,
      cookie: cookieHeader
    },
    payload: {
      messageId: "msg_auth_2",
      input: "hello"
    }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(handlerCalled, false);
  await app.close();
});
