import assert from "node:assert/strict";
import test from "node:test";
import { createAuthExtensions } from "../src/server/authExtensions.js";
import {
  registerAuthPolicyContextResolver,
  resolveComposedAuthPolicyContextResolver
} from "../src/server/authPolicyContextResolverRegistry.js";

test("auth.extensions composes policy context resolvers in order", async () => {
  const extensions = createAuthExtensions();
  registerAuthPolicyContextResolver(extensions, {
    resolverId: "permissions",
    order: 20,
    async resolveAuthPolicyContext() {
      return { permissions: ["alpha.read"] };
    }
  });
  registerAuthPolicyContextResolver(extensions, {
    resolverId: "workspace",
    order: 10,
    async resolveAuthPolicyContext() {
      return {
        workspace: { id: "11" },
        membership: { roleSid: "member" },
        permissions: ["workspace.read"]
      };
    }
  });
  const resolveContext = resolveComposedAuthPolicyContextResolver(extensions);
  assert.deepEqual(await resolveContext({ actor: { id: "7" } }), {
    workspace: { id: "11" },
    membership: { roleSid: "member" },
    permissions: ["workspace.read", "alpha.read"]
  });
  assert.deepEqual(extensions.diagnostics().policyContextResolverIds, ["workspace", "permissions"]);
});
