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
      if (token !== "jskit.http.router") {
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
  const consoleSettingsReadRoute = findRoute(registeredRoutes, "GET", "/api/console/settings/assistant");
  const consoleSettingsPatchRoute = findRoute(registeredRoutes, "PATCH", "/api/console/settings/assistant");
  const workspaceSettingsReadRoute = findRoute(
    registeredRoutes,
    "GET",
    "/api/w/:workspaceSlug/workspace/settings/assistant"
  );
  const workspaceSettingsPatchRoute = findRoute(
    registeredRoutes,
    "PATCH",
    "/api/w/:workspaceSlug/workspace/settings/assistant"
  );
  assert.ok(conversationsRoute);
  assert.ok(messagesRoute);
  assert.ok(consoleSettingsReadRoute);
  assert.ok(consoleSettingsPatchRoute);
  assert.ok(workspaceSettingsReadRoute);
  assert.ok(workspaceSettingsPatchRoute);

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
  await consoleSettingsReadRoute.handler(
    {
      input: {},
      executeAction
    },
    createReplyDouble()
  );
  await consoleSettingsPatchRoute.handler(
    {
      input: {
        body: { workspaceSurfacePrompt: "Console prompt" }
      },
      executeAction
    },
    createReplyDouble()
  );
  await workspaceSettingsReadRoute.handler(
    {
      input: {
        params: { workspaceSlug: "acme" }
      },
      executeAction
    },
    createReplyDouble()
  );
  await workspaceSettingsPatchRoute.handler(
    {
      input: {
        params: { workspaceSlug: "acme" },
        body: { appSurfacePrompt: "Workspace prompt" }
      },
      executeAction
    },
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, {
    workspaceSlug: "acme",
    query: { cursor: 30, limit: 50, status: "active" }
  });
  assert.deepEqual(calls[0].context, {
    surface: "app"
  });
  assert.deepEqual(calls[1].input, {
    workspaceSlug: "acme",
    conversationId: 10,
    query: { page: 3, pageSize: 100 }
  });
  assert.deepEqual(calls[1].context, {
    surface: "app"
  });
  assert.deepEqual(calls[2], {
    actionId: "assistant.console.settings.read"
  });
  assert.deepEqual(calls[3], {
    actionId: "assistant.console.settings.update",
    input: {
      payload: {
        workspaceSurfacePrompt: "Console prompt"
      }
    }
  });
  assert.deepEqual(calls[4], {
    actionId: "assistant.workspace.settings.read",
    context: {
      surface: "app"
    },
    input: {
      workspaceSlug: "acme"
    }
  });
  assert.deepEqual(calls[5], {
    actionId: "assistant.workspace.settings.update",
    context: {
      surface: "app"
    },
    input: {
      workspaceSlug: "acme",
      patch: {
        appSurfacePrompt: "Workspace prompt"
      }
    }
  });
});

test("assistant workspace routes use workspace default surface and honor x-jskit-surface header", async () => {
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
    has(token) {
      return token === "appConfig";
    },
    make(token) {
      if (token === "jskit.http.router") {
        return router;
      }
      if (token === "appConfig") {
        return {
          surfaceDefaultId: "admin",
          surfaceDefinitions: {
            app: {
              id: "app",
              enabled: true,
              requiresWorkspace: true
            },
            admin: {
              id: "admin",
              enabled: true,
              requiresWorkspace: true
            },
            console: {
              id: "console",
              enabled: true,
              requiresWorkspace: false
            }
          }
        };
      }
      throw new Error(`Unexpected token: ${String(token)}`);
    }
  };

  registerRoutes(app);

  const expectedWorkspaceRoutes = [
    ["GET", "/api/w/:workspaceSlug/workspace/settings/assistant"],
    ["PATCH", "/api/w/:workspaceSlug/workspace/settings/assistant"],
    ["POST", "/api/w/:workspaceSlug/assistant/chat/stream"],
    ["GET", "/api/w/:workspaceSlug/assistant/conversations"],
    ["GET", "/api/w/:workspaceSlug/assistant/conversations/:conversationId/messages"]
  ];

  for (const [method, path] of expectedWorkspaceRoutes) {
    const route = findRoute(registeredRoutes, method, path);
    assert.ok(route);
    assert.equal(route.route.surface, "admin");
  }

  const conversationsRoute = findRoute(registeredRoutes, "GET", "/api/w/:workspaceSlug/assistant/conversations");
  const actionCalls = [];
  const executeAction = async (payload) => {
    actionCalls.push(payload);
    return {};
  };

  await conversationsRoute.handler(
    {
      headers: {
        "x-jskit-surface": "app"
      },
      input: {
        params: { workspaceSlug: "acme" },
        query: {}
      },
      executeAction
    },
    createReplyDouble()
  );
  await conversationsRoute.handler(
    {
      headers: {
        "x-jskit-surface": "missing"
      },
      input: {
        params: { workspaceSlug: "acme" },
        query: {}
      },
      executeAction
    },
    createReplyDouble()
  );

  assert.equal(actionCalls.length, 2);
  assert.deepEqual(actionCalls[0].context, {
    surface: "app"
  });
  assert.deepEqual(actionCalls[1].context, {
    surface: "admin"
  });
});
