import assert from "node:assert/strict";
import test, { after } from "node:test";
import { resolveApiBasePath } from "@jskit-ai/users-core/shared/support/usersApiPaths";
import { createTemplateServerFixture } from "../test-support/templateServerFixture.js";

const fixture = await createTemplateServerFixture();
const { registerRoutes } = await fixture.importServerModule("registerRoutes.js");

after(async () => {
  await fixture.cleanup();
});

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
    routeSurfaceRequiresWorkspace: true
  });

  const workspaceRouteBase = resolveApiBasePath({
    surfaceRequiresWorkspace: true,
    relativePath: "/customers"
  });
  const createRoute = findRoute(registeredRoutes, "POST", workspaceRouteBase);
  const updateRoute = findRoute(registeredRoutes, "PATCH", `${workspaceRouteBase}/:recordId`);
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
    routeSurface: "console"
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

test("crud routes validate route ownership filter values before registering visibility", () => {
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
    routeOwnershipFilter: " Workspace_User "
  });
  assert.throws(
    () =>
      registerRoutes(app, {
        routeRelativePath: "/customers-public",
        routeOwnershipFilter: "not-a-real-filter"
      }),
    /must be one of/
  );

  const workspaceUserRoute = findRoute(registeredRoutes, "GET", "/api/customers");

  assert.ok(workspaceUserRoute);
  assert.equal(workspaceUserRoute.route.visibility, "workspace_user");
});

test("crud list route forwards normalized query input from list query validators", async () => {
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
    routeSurfaceRequiresWorkspace: true
  });

  const workspaceRouteBase = resolveApiBasePath({
    surfaceRequiresWorkspace: true,
    relativePath: "/customers"
  });
  const listRoute = findRoute(registeredRoutes, "GET", workspaceRouteBase);
  assert.ok(listRoute);

  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

  await listRoute.handler(
    {
      input: {
        params: { workspaceSlug: "acme" },
        query: {
          cursor: 3,
          limit: 25,
          q: "to"
        }
      },
      executeAction
    },
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, {
    workspaceSlug: "acme",
    cursor: 3,
    limit: 25,
    q: "to"
  });
});
