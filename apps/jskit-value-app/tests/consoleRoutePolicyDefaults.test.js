import assert from "node:assert/strict";
import test from "node:test";
import { buildRoutes } from "../server/modules/api/routes.js";

function createControllerProxy() {
  const fallbackHandler = new Proxy(
    async (_request, reply) => {
      if (reply && typeof reply.code === "function") {
        reply.code(200).send({ ok: true });
      }
    },
    {
      get() {
        return fallbackHandler;
      }
    }
  );

  return new Proxy(
    {},
    {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }
        return fallbackHandler;
      }
    }
  );
}

test("console API routes default to optional workspace policy on console surface", () => {
  const routes = buildRoutes(createControllerProxy());
  const consoleBootstrapRoute = routes.find(
    (route) => route.method === "GET" && route.path === "/api/v1/console/bootstrap"
  );
  const consolePurchasesRoute = routes.find(
    (route) => route.method === "GET" && route.path === "/api/v1/console/billing/purchases"
  );
  const workspaceBootstrapRoute = routes.find((route) => route.method === "GET" && route.path === "/api/v1/bootstrap");

  assert.ok(consoleBootstrapRoute);
  assert.equal(consoleBootstrapRoute.workspacePolicy, "optional");
  assert.equal(consoleBootstrapRoute.workspaceSurface, "console");

  assert.ok(consolePurchasesRoute);
  assert.equal(consolePurchasesRoute.workspacePolicy, "optional");
  assert.equal(consolePurchasesRoute.workspaceSurface, "console");

  assert.ok(workspaceBootstrapRoute);
  assert.notEqual(workspaceBootstrapRoute.workspaceSurface, "console");
});
