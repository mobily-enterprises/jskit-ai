import assert from "node:assert/strict";
import test from "node:test";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerCompleteCalendarRoutes } from "../src/server/completeCalendar/registerCompleteCalendarRoutes.js";

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

test("calendar routes build explicit query and patch contracts", async () => {
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

  registerCompleteCalendarRoutes(app);

  const weekListRoute = findRoute(registeredRoutes, "GET", "/api/w/:workspaceSlug/workspace/calendar/events");
  const updateRoute = findRoute(registeredRoutes, "PATCH", "/api/w/:workspaceSlug/workspace/calendar/events/:eventId");
  assert.ok(weekListRoute);
  assert.ok(updateRoute);

  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

  await weekListRoute.handler(
    {
      input: {
        params: { workspaceSlug: "acme" },
        query: { weekStart: "2026-03-16", contactId: 9 }
      },
      executeAction
    },
    createReplyDouble()
  );
  await updateRoute.handler(
    {
      input: {
        params: { workspaceSlug: "acme", eventId: 42 },
        body: { title: "Rescheduled" }
      },
      executeAction
    },
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, {
    workspaceSlug: "acme",
    query: { weekStart: "2026-03-16", contactId: 9 }
  });
  assert.deepEqual(calls[1].input, {
    workspaceSlug: "acme",
    eventId: 42,
    patch: { title: "Rescheduled" }
  });
});
