import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultRoutes } from "../routes/api/index.js";

const ADMIN_SURFACE_PERMISSION_ALLOWLIST = new Set([
  // Add explicit exceptions in "METHOD /path" format.
]);

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

  return {
    auth: handlerProxy,
    workspace: handlerProxy,
    settings: handlerProxy,
    history: handlerProxy,
    annuity: handlerProxy
  };
}

function toRouteKey(route) {
  return `${String(route?.method || "").toUpperCase()} ${String(route?.path || "")}`.trim();
}

test("admin-surface routes require explicit permissions unless allowlisted", () => {
  const routes = buildDefaultRoutes(createNoopControllers());
  const adminRoutes = routes.filter((route) => String(route.workspaceSurface || "").trim() === "admin");
  const adminRouteKeys = new Set(adminRoutes.map(toRouteKey));

  const staleAllowlistEntries = Array.from(ADMIN_SURFACE_PERMISSION_ALLOWLIST).filter(
    (routeKey) => !adminRouteKeys.has(routeKey)
  );

  assert.deepEqual(
    staleAllowlistEntries,
    [],
    `Admin permission allowlist has stale entries: ${staleAllowlistEntries.join(", ")}`
  );

  const violations = adminRoutes
    .filter((route) => {
      const routeKey = toRouteKey(route);
      const hasPermission = String(route.permission || "").trim().length > 0;
      return !hasPermission && !ADMIN_SURFACE_PERMISSION_ALLOWLIST.has(routeKey);
    })
    .map(toRouteKey);

  assert.deepEqual(violations, [], `Admin routes missing permission: ${violations.join(", ")}`);
});
