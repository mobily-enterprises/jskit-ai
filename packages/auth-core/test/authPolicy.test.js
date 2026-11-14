import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { createAuthExtensions } from "../src/server/authExtensions.js";
import { createAuthPolicy } from "../src/server/authPolicy.js";
import { authPolicyPlugin } from "../src/server/lib/index.js";

const ROLE_PERMISSIONS = Object.freeze({
  owner: ["*"],
  editor: ["crud.labels.*"],
  viewer: ["crud.labels.list", "crud.labels.view"]
});

async function createApp(t) {
  const extensions = createAuthExtensions();
  extensions.registerPolicyContextResolver({
    resolverId: "test.roles",
    async resolveAuthPolicyContext({ request }) {
      return { permissions: ROLE_PERMISSIONS[request.headers["x-role"]] ?? [] };
    }
  });
  const policy = createAuthPolicy({
    authService: {
      async authenticateRequest() {
        return { authenticated: true, actor: { id: 1 }, transientFailure: false };
      }
    },
    extensions,
    env: { APP_ENV: "test" }
  });

  const app = Fastify();
  t.after(() => app.close());
  await authPolicyPlugin(policy, policy.options)(app);
  app.get("/api/labels/1/edit", {
    config: { authPolicy: "required", permission: "crud.labels.update" }
  }, () => ({ allowed: true }));
  return app;
}

test("a route permission is satisfied by the grant \"*\" and by a grant ending in \".*\", as action permissions are", async (t) => {
  const app = await createApp(t);

  for (const role of ["owner", "editor"]) {
    const response = await app.inject({ method: "GET", url: "/api/labels/1/edit", headers: { "x-role": role } });
    assert.equal(response.statusCode, 200, `${role} holds a grant covering crud.labels.update`);
    assert.deepEqual(response.json(), { allowed: true });
  }

  const denied = await app.inject({ method: "GET", url: "/api/labels/1/edit", headers: { "x-role": "viewer" } });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, "auth.policy.permissionDenied");
});
