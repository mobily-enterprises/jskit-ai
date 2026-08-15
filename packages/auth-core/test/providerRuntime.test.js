import assert from "node:assert/strict";
import test from "node:test";
import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { HttpProvider } from "@jskit-ai/kernel/server/http";
import { createFakeFastifyPolicyRuntime } from "../../../tooling/testUtils/fakeFastify.mjs";
import { AuthExtensionsProvider } from "../src/server/providers/AuthExtensionsProvider.js";
import { AuthFeature } from "../src/server/providers/AuthFeature.js";
import { AuthPolicyProvider } from "../src/server/providers/AuthPolicyProvider.js";

function createFastify() {
  const fixture = createFakeFastifyPolicyRuntime();
  fixture.fastify.route = () => {};
  fixture.fastify.setErrorHandler = () => {};
  return fixture;
}

function runtimeInputs(fastify) {
  return {
    "runtime.env": { NODE_ENV: "test" },
    "runtime.fastify": fastify
  };
}

test("AuthPolicyProvider installs Fastify policy and explicit action/visibility contributors", async () => {
  const { fastify, state } = createFastify();
  const runtime = createCapabilityRuntime({
    inputs: runtimeInputs(fastify),
    providers: [
      createActionProvider(),
      HttpProvider,
      AuthExtensionsProvider,
      AuthFeature,
      AuthPolicyProvider
    ]
  });
  await runtime.start();
  assert.ok(state.requestDecorators.has("user"));
  assert.ok(state.requestDecorators.has("workspace"));
  assert.ok(state.requestDecorators.has("membership"));
  assert.ok(state.requestDecorators.has("permissions"));
  assert.equal(typeof state.preHandler, "function");
  assert.ok(state.registeredPlugins.length >= 3);
  assert.ok(runtime.diagnostics().capabilityIds.includes("auth.policy"));
});

test("AuthPolicyProvider resolves registered workspace context without a service container", async () => {
  const { fastify, state } = createFastify();
  const AuthService = defineProvider({
    id: "test.auth.service",
    provides: { service: "auth.service" },
    setup() {
      return {
        service: {
          async authenticateRequest() {
            return { authenticated: true, actor: { id: 7 }, transientFailure: false };
          }
        }
      };
    }
  });
  const WorkspaceContext = defineProvider({
    id: "test.workspace-auth-context",
    requires: { extensions: "auth.extensions" },
    setup({ extensions }) {
      extensions.registerPolicyContextResolver({
        resolverId: "workspace",
        async resolveAuthPolicyContext({ actor, request }) {
          return {
            workspace: { id: 11, slug: String(request?.params?.workspaceSlug || "").toLowerCase() },
            membership: { roleSid: "member" },
            permissions: actor?.id === 7 ? ["projects.read"] : []
          };
        }
      });
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: runtimeInputs(fastify),
    providers: [
      createActionProvider(),
      HttpProvider,
      AuthExtensionsProvider,
      AuthService,
      WorkspaceContext,
      AuthFeature,
      AuthPolicyProvider
    ]
  });
  await runtime.start();
  const request = {
    method: "GET",
    raw: { url: "/api/w/acme/projects" },
    params: { workspaceSlug: "ACME" },
    routeOptions: {
      config: {
        authPolicy: "required",
        contextPolicy: "required",
        permission: "projects.read"
      }
    }
  };
  await state.preHandler(request, {});
  assert.deepEqual(request.workspace, { id: 11, slug: "acme" });
  assert.deepEqual(request.membership, { roleSid: "member" });
  assert.deepEqual(request.permissions, ["projects.read"]);
});

test("auth policy denies protected routes when no auth service is installed", async () => {
  const { fastify, state } = createFastify();
  const runtime = createCapabilityRuntime({
    inputs: runtimeInputs(fastify),
    providers: [
      createActionProvider(),
      HttpProvider,
      AuthExtensionsProvider,
      AuthFeature,
      AuthPolicyProvider
    ]
  });
  await runtime.start();
  await assert.rejects(() => state.preHandler({
    method: "GET",
    raw: { url: "/api/protected" },
    routeOptions: { config: { authPolicy: "required" } }
  }, {}), /Authentication required/);
});
