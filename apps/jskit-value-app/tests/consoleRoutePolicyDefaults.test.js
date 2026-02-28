import assert from "node:assert/strict";
import test from "node:test";
import { buildRoutes, ROUTE_MODULE_DEFINITIONS } from "../server/modules/api/routes.js";
import { createControllerProxy } from "./helpers/createControllerProxy.js";

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

test("console defaults do not apply to console-like prefixes", () => {
  const patchedDefinition = ROUTE_MODULE_DEFINITIONS[0];
  const originalBuildRoutes = patchedDefinition.buildRoutes;

  patchedDefinition.buildRoutes = () => [
    {
      path: "/api/consolex/synthetic",
      method: "GET",
      handler: async (_request, reply) => {
        reply.code(200).send({ ok: true });
      }
    }
  ];

  try {
    const routes = buildRoutes(createControllerProxy());
    const syntheticRoute = routes.find((route) => route.path === "/api/v1/consolex/synthetic");
    assert.ok(syntheticRoute);
    assert.equal(syntheticRoute.workspacePolicy, undefined);
    assert.equal(syntheticRoute.workspaceSurface, undefined);
  } finally {
    patchedDefinition.buildRoutes = originalBuildRoutes;
  }
});
