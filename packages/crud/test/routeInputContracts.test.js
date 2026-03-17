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

test("crud routes build create/update action input with explicit payload and patch keys", async () => {
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

  registerRoutes(app, {
    routeBasePath: "/api/w/:workspaceSlug/crud/customers",
    actionIds: {
      list: "crud.customers.list",
      view: "crud.customers.view",
      create: "crud.customers.create",
      update: "crud.customers.update",
      delete: "crud.customers.delete"
    }
  });

  const createRoute = findRoute(registeredRoutes, "POST", "/api/w/:workspaceSlug/crud/customers");
  const updateRoute = findRoute(registeredRoutes, "PATCH", "/api/w/:workspaceSlug/crud/customers/:recordId");
  assert.ok(createRoute);
  assert.ok(updateRoute);

  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

  await createRoute.handler(
    {
      input: {
        params: { workspaceSlug: "acme" },
        body: { name: "A", surname: "B" }
      },
      executeAction
    },
    createReplyDouble()
  );
  await updateRoute.handler(
    {
      input: {
        params: { workspaceSlug: "acme", recordId: 12 },
        body: { name: "Renamed" }
      },
      executeAction
    },
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, {
    workspaceSlug: "acme",
    payload: { name: "A", surname: "B" }
  });
  assert.deepEqual(calls[1].input, {
    workspaceSlug: "acme",
    recordId: 12,
    patch: { name: "Renamed" }
  });
});
