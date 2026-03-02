import assert from "node:assert/strict";
import test from "node:test";
import { registerClientRoutes } from "../src/client/routes/registerClientRoutes.js";

test("auth-web registers global login and signout client routes", () => {
  const routes = [];

  registerClientRoutes({
    registerRoutes(nextRoutes) {
      routes.push(...nextRoutes);
    }
  });

  assert.equal(routes.length, 2);
  assert.deepEqual(
    routes.map((route) => ({
      id: route.id,
      path: route.path,
      scope: route.scope,
      componentPath: route.componentPath,
      guardPolicy: route?.meta?.guard?.policy || ""
    })),
    [
      {
        id: "auth.login",
        path: "/auth/login",
        scope: "global",
        componentPath: "/src/views/auth/LoginView.vue",
        guardPolicy: "public"
      },
      {
        id: "auth.signout",
        path: "/auth/signout",
        scope: "global",
        componentPath: "/src/views/auth/SignOutView.vue",
        guardPolicy: "public"
      }
    ]
  );
});
