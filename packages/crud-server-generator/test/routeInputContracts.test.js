import assert from "node:assert/strict";
import test, { after } from "node:test";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { recordIdParamsValidator } from "@jskit-ai/kernel/shared/validators";
import { createTemplateServerFixture } from "../test-support/templateServerFixture.js";

const workspaceFixture = await createTemplateServerFixture();
const nonWorkspaceFixture = await createTemplateServerFixture({
  surfaceRequiresWorkspace: false,
  requiresNamedPermissions: false
});
const { registerRoutes: registerWorkspaceRoutes } = await workspaceFixture.importServerModule("registerRoutes.js");
const { registerRoutes: registerNonWorkspaceRoutes } = await nonWorkspaceFixture.importServerModule("registerRoutes.js");

after(async () => {
  await workspaceFixture.cleanup();
  await nonWorkspaceFixture.cleanup();
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

  registerWorkspaceRoutes(app, {
    routeRelativePath: "/customers"
  });

  const workspaceRouteBase = resolveScopedApiBasePath({
    routeBase: "/w/:workspaceSlug",
    relativePath: "/customers",
    strictParams: false
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

  registerNonWorkspaceRoutes(app, {
    routeRelativePath: "/customers",
    routeSurface: "console"
  });

  const createRoute = findRoute(registeredRoutes, "POST", "/api/customers");
  assert.ok(createRoute);
  assert.equal(createRoute.route.surface, "console");
  assert.equal(createRoute.route.params, undefined);

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

test("crud non-workspace record routes validate only recordId params", () => {
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

  registerNonWorkspaceRoutes(app, {
    routeRelativePath: "/customers",
    routeSurface: "console"
  });

  const viewRoute = findRoute(registeredRoutes, "GET", "/api/customers/:recordId");
  const updateRoute = findRoute(registeredRoutes, "PATCH", "/api/customers/:recordId");
  const deleteRoute = findRoute(registeredRoutes, "DELETE", "/api/customers/:recordId");

  assert.ok(viewRoute);
  assert.ok(updateRoute);
  assert.ok(deleteRoute);
  assert.equal(viewRoute.route.params, recordIdParamsValidator);
  assert.equal(updateRoute.route.params, recordIdParamsValidator);
  assert.equal(deleteRoute.route.params, recordIdParamsValidator);
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

  registerWorkspaceRoutes(app, {
    routeRelativePath: "/customers",
    routeOwnershipFilter: " Workspace_User "
  });
  assert.throws(
    () =>
      registerWorkspaceRoutes(app, {
        routeRelativePath: "/customers-public",
        routeOwnershipFilter: "not-a-real-filter"
      }),
    /must be one of/
  );

  const workspaceRouteBase = resolveScopedApiBasePath({
    routeBase: "/w/:workspaceSlug",
    relativePath: "/customers",
    strictParams: false
  });
  const workspaceUserRoute = findRoute(registeredRoutes, "GET", workspaceRouteBase);

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

  registerWorkspaceRoutes(app, {
    routeRelativePath: "/customers"
  });

  const workspaceRouteBase = resolveScopedApiBasePath({
    routeBase: "/w/:workspaceSlug",
    relativePath: "/customers",
    strictParams: false
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
          q: "to",
          contactId: "2971",
          include: "vetId"
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
    q: "to",
    contactId: "2971",
    include: "vetId"
  });
});

test("crud view route forwards include query input", async () => {
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

  registerWorkspaceRoutes(app, {
    routeRelativePath: "/customers"
  });

  const workspaceRouteBase = resolveScopedApiBasePath({
    routeBase: "/w/:workspaceSlug",
    relativePath: "/customers",
    strictParams: false
  });
  const viewRoute = findRoute(registeredRoutes, "GET", `${workspaceRouteBase}/:recordId`);
  assert.ok(viewRoute);

  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

  await viewRoute.handler(
    {
      input: {
        params: { workspaceSlug: "acme", recordId: 7 },
        query: { include: "vetId" }
      },
      executeAction
    },
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, {
    workspaceSlug: "acme",
    recordId: 7,
    include: "vetId"
  });
});
