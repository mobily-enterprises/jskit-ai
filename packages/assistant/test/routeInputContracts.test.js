import assert from "node:assert/strict";
import test from "node:test";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerRoutes } from "../src/server/registerRoutes.js";

function createReplyDouble() {
  return {
    statusCode: 200,
    payload: null,
    code(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function findRoute(routes, method, path) {
  return routes.find((route) => route.method === method && route.path === path) || null;
}

test("assistant routes build list inputs with explicit query object", async () => {
  const registeredRoutes = [];
  const router = {
    register(method, path, route, handler) {
      registeredRoutes.push({
        method,
        path,
        route,
        handler
      });
    }
  };
  const app = {
    make(token) {
      if (token !== KERNEL_TOKENS.HttpRouter) {
        throw new Error(`Unexpected token: ${String(token)}`);
      }
      return router;
    }
  };

  registerRoutes(app);

  const conversationsRoute = findRoute(registeredRoutes, "GET", "/api/w/:workspaceSlug/assistant/conversations");
  const messagesRoute = findRoute(
    registeredRoutes,
    "GET",
    "/api/w/:workspaceSlug/assistant/conversations/:conversationId/messages"
  );
  assert.ok(conversationsRoute);
  assert.ok(messagesRoute);

  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

  await conversationsRoute.handler(
    {
      input: {
        params: { workspaceSlug: "acme" },
        query: { cursor: 30, limit: 50, status: "active" }
      },
      executeAction
    },
    createReplyDouble()
  );
  await messagesRoute.handler(
    {
      input: {
        params: { workspaceSlug: "acme", conversationId: 10 },
        query: { page: 3, pageSize: 100 }
      },
      executeAction
    },
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, {
    workspaceSlug: "acme",
    query: { cursor: 30, limit: 50, status: "active" }
  });
  assert.deepEqual(calls[1].input, {
    workspaceSlug: "acme",
    conversationId: 10,
    query: { page: 3, pageSize: 100 }
  });
});
