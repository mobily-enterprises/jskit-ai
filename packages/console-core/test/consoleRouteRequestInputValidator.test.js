import assert from "node:assert/strict";
import test from "node:test";
import { ConsoleCoreServiceProvider } from "../src/server/ConsoleCoreServiceProvider.js";

function createReplyDouble() {
  return {
    statusCode: 200,
    payload: null,
    redirectedTo: "",
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
      return this;
    },
    redirect(value) {
      this.redirectedTo = String(value || "");
      return this;
    }
  };
}

function findRoute(routes, { method, path }) {
  return routes.find((route) => route.method === method && route.path === path) || null;
}

async function registerRoutes({
  consoleService = {}
} = {}) {
  const registeredRoutes = [];
  const router = {
    register(method, path, route, handler) {
      registeredRoutes.push({
        ...route,
        method,
        path,
        handler
      });
    }
  };

  const bindings = new Map([
    ["jskit.http.router", router],
    ["actionExecutor", {}]
  ]);

  bindings.set("consoleService", consoleService);

  const app = {
    has(token) {
      return bindings.has(token);
    },
    make(token) {
      if (!bindings.has(token)) {
        throw new Error(`Missing test binding for token: ${String(token)}`);
      }
      return bindings.get(token);
    }
  };

  const provider = new ConsoleCoreServiceProvider();
  await provider.boot(app);

  return registeredRoutes;
}

function createActionRequest({ input = {}, executeAction, file = null }) {
  return {
    input,
    executeAction,
    file,
    user: {
      id: 42
    }
  };
}

test("console-core boot mounts console routes", async () => {
  const routes = await registerRoutes();
  const getRoute = findRoute(routes, { method: "GET", path: "/api/console/settings" });
  const patchRoute = findRoute(routes, { method: "PATCH", path: "/api/console/settings" });

  assert.equal(getRoute?.path, "/api/console/settings");
  assert.equal(patchRoute?.path, "/api/console/settings");
  assert.equal(getRoute?.transport?.kind, "jsonapi-resource");
  assert.equal(patchRoute?.transport?.kind, "jsonapi-resource");
  assert.equal(getRoute?.responses?.[200]?.transportSchema?.required?.[0], "data");
  assert.equal(patchRoute?.advanced?.fastifySchema?.body?.required?.[0], "data");
  assert.equal(patchRoute?.responses?.[200]?.transportSchema?.required?.[0], "data");
});

test("console settings route handlers use request.input payloads", async () => {
  const routes = await registerRoutes();
  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {
      settings: {}
    };
  };

  await findRoute(routes, { method: "GET", path: "/api/console/settings" }).handler(
    createActionRequest({ executeAction }),
    createReplyDouble()
  );

  await findRoute(routes, { method: "PATCH", path: "/api/console/settings" }).handler(
    createActionRequest({
      input: {
        body: {}
      },
      executeAction
    }),
    createReplyDouble()
  );

  assert.equal(calls[0].actionId, "console.settings.read");
  assert.deepEqual(calls[1], {
    actionId: "console.settings.update",
    input: {}
  });
});
