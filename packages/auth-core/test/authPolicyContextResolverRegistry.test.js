import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel/_testable";
import {
  AUTH_POLICY_CONTEXT_RESOLVER_TAG,
  composeAuthPolicyContextResolvers,
  registerAuthPolicyContextResolver,
  resolveAuthPolicyContextResolvers
} from "../src/server/authPolicyContextResolverRegistry.js";

test("auth policy context resolver registry resolves resolvers in order", async () => {
  const app = createApplication();

  registerAuthPolicyContextResolver(app, "test.auth.policy.context.permissions", () => ({
    resolverId: "permissions",
    order: 20,
    async resolveAuthPolicyContext() {
      return {
        permissions: ["alpha.read"]
      };
    }
  }));

  registerAuthPolicyContextResolver(app, "test.auth.policy.context.workspace", () => ({
    resolverId: "workspace",
    order: 10,
    async resolveAuthPolicyContext() {
      return {
        workspace: { id: "11" },
        membership: { roleSid: "member" },
        permissions: ["workspace.read"]
      };
    }
  }));

  const resolvers = resolveAuthPolicyContextResolvers(app);
  assert.deepEqual(
    resolvers.map((entry) => entry.resolverId),
    ["workspace", "permissions"]
  );

  const resolveContext = composeAuthPolicyContextResolvers(resolvers);
  const context = await resolveContext({
    actor: { id: "7" }
  });

  assert.deepEqual(context, {
    workspace: { id: "11" },
    membership: { roleSid: "member" },
    permissions: ["workspace.read", "alpha.read"]
  });
});

test("auth policy context resolver registry exports canonical tag", () => {
  assert.equal(AUTH_POLICY_CONTEXT_RESOLVER_TAG, "jskit.auth.policy.context.resolvers");
});
