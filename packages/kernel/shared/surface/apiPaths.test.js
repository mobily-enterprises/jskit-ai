import test from "node:test";
import assert from "node:assert/strict";
import { resolveScopedApiBasePath, resolveScopedRouteBase } from "./apiPaths.js";

test("resolveScopedRouteBase keeps the route prefix through the last dynamic segment", () => {
  assert.equal(resolveScopedRouteBase("/"), "/");
  assert.equal(resolveScopedRouteBase("/home"), "/");
  assert.equal(resolveScopedRouteBase("/w/:workspaceSlug"), "/w/:workspaceSlug");
  assert.equal(resolveScopedRouteBase("/w/:workspaceSlug/admin"), "/w/:workspaceSlug");
  assert.equal(resolveScopedRouteBase("/org/:orgId/team/:teamId/admin"), "/org/:orgId/team/:teamId");
});

test("resolveScopedApiBasePath materializes scoped API paths from route templates", () => {
  assert.equal(resolveScopedApiBasePath({ routeBase: "/home", relativePath: "/settings" }), "/api/settings");
  assert.equal(
    resolveScopedApiBasePath({
      routeBase: "/w/:workspaceSlug/admin",
      relativePath: "/members",
      params: { workspaceSlug: "acme" }
    }),
    "/api/w/acme/members"
  );
  assert.throws(
    () =>
      resolveScopedApiBasePath({
        routeBase: "/w/:workspaceSlug/admin",
        relativePath: "/members"
      }),
    /missing required route params/
  );
});
