import assert from "node:assert/strict";
import test from "node:test";
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
      if (token !== "jskit.http.router") {
        throw new Error(`Unexpected token: ${String(token)}`);
      }
      return router;
    }
  };

  registerRoutes(app, {
    routeRelativePath: "/customers",
    routeSurfaceRequiresWorkspace: true,
    actionIds: {
      list: "crud.customers.list",
      view: "crud.customers.view",
      create: "crud.customers.create",
      update: "crud.customers.update",
      delete: "crud.customers.delete"
    }
  });

  const createRoute = findRoute(registeredRoutes, "POST", "/api/w/:workspaceSlug/workspace/customers");
  const updateRoute = findRoute(registeredRoutes, "PATCH", "/api/w/:workspaceSlug/workspace/customers/:recordId");
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
        body: { textField: "A", dateField: "2026-03-11", numberField: 2 }
      },
      executeAction
    },
    createReplyDouble()
  );
  await updateRoute.handler(
    {
      input: {
        params: { workspaceSlug: "acme", recordId: 12 },
        body: { textField: "Renamed" }
      },
      executeAction
    },
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, {
    workspaceSlug: "acme",
    payload: { textField: "A", dateField: "2026-03-11", numberField: 2 }
  });
  assert.deepEqual(calls[1].input, {
    workspaceSlug: "acme",
    recordId: 12,
    patch: { textField: "Renamed" }
  });
});

test("crud routes omit workspaceSlug for non-workspace calls and apply configured route surface", async () => {
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
      if (token !== "jskit.http.router") {
        throw new Error(`Unexpected token: ${String(token)}`);
      }
      return router;
    }
  };

  registerRoutes(app, {
    routeRelativePath: "/customers",
    routeSurface: "console",
    actionIds: {
      list: "crud.customers.list",
      view: "crud.customers.view",
      create: "crud.customers.create",
      update: "crud.customers.update",
      delete: "crud.customers.delete"
    }
  });

  const createRoute = findRoute(registeredRoutes, "POST", "/api/customers");
  assert.ok(createRoute);
  assert.equal(createRoute.route.surface, "console");

  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

  await createRoute.handler(
    {
      input: {
        params: {},
        body: { textField: "A", dateField: "2026-03-11", numberField: 2 }
      },
      executeAction
    },
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, {
    payload: { textField: "A", dateField: "2026-03-11", numberField: 2 }
  });
});

test("crud routes normalize route ownership filter values before registering visibility", () => {
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
      if (token !== "jskit.http.router") {
        throw new Error(`Unexpected token: ${String(token)}`);
      }
      return router;
    }
  };

  registerRoutes(app, {
    routeRelativePath: "/customers",
    routeOwnershipFilter: " Workspace_User ",
    actionIds: {
      list: "crud.customers.list",
      view: "crud.customers.view",
      create: "crud.customers.create",
      update: "crud.customers.update",
      delete: "crud.customers.delete"
    }
  });
  registerRoutes(app, {
    routeRelativePath: "/customers-public",
    routeOwnershipFilter: "not-a-real-filter",
    actionIds: {
      list: "crud.customers-public.list",
      view: "crud.customers-public.view",
      create: "crud.customers-public.create",
      update: "crud.customers-public.update",
      delete: "crud.customers-public.delete"
    }
  });

  const workspaceUserRoute = findRoute(registeredRoutes, "GET", "/api/customers");
  const fallbackPublicRoute = findRoute(registeredRoutes, "GET", "/api/customers-public");

  assert.ok(workspaceUserRoute);
  assert.ok(fallbackPublicRoute);
  assert.equal(workspaceUserRoute.route.visibility, "workspace_user");
  assert.equal(fallbackPublicRoute.route.visibility, "public");
});
