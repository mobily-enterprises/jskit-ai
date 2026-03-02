import assert from "node:assert/strict";
import test from "node:test";
import { buildRoutes } from "../server/modules/api/index.js";

function createNoopControllers() {
  const noop = async () => {};
  const handlerProxy = new Proxy(
    {},
    {
      get() {
        return noop;
      }
    }
  );

  return new Proxy(
    {},
    {
      get() {
        return handlerProxy;
      }
    }
  );
}

function findRoute(routes, method, path) {
  return routes.find(
    (route) => String(route?.method || "").toUpperCase() === method && String(route?.path || "") === path
  );
}

test("workspace self-service routes keep required auth and selector-safe policy defaults", () => {
  const routes = buildRoutes(createNoopControllers());

  const expectations = [
    ["GET", "/api/v1/workspaces"],
    ["POST", "/api/v1/workspaces/select"],
    ["GET", "/api/v1/workspace/invitations/pending"],
    ["POST", "/api/v1/workspace/invitations/redeem"]
  ];

  for (const [method, path] of expectations) {
    const route = findRoute(routes, method, path);
    assert.ok(route, `missing route ${method} ${path}`);
    assert.equal(route.auth, "required", `${method} ${path} auth drifted`);
    assert.equal(route.workspacePolicy, undefined, `${method} ${path} workspacePolicy drifted`);
    assert.equal(route.workspaceSurface, undefined, `${method} ${path} workspaceSurface drifted`);
    assert.equal(route.permission, undefined, `${method} ${path} permission drifted`);
  }
});

test("workspace admin routes remain explicitly workspace-scoped", () => {
  const routes = buildRoutes(createNoopControllers());
  const route = findRoute(routes, "GET", "/api/v1/admin/workspace/settings");

  assert.ok(route);
  assert.equal(route.auth, "required");
  assert.equal(route.workspacePolicy, "required");
  assert.equal(route.workspaceSurface, "admin");
  assert.equal(route.permission, "workspace.settings.view");
});
