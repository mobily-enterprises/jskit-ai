import assert from "node:assert/strict";
import test from "node:test";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { AUTH_POLICY_CONTEXT_RESOLVER_TOKEN } from "../src/server/lib/tokens.js";
import { FastifyAuthPolicyServiceProvider } from "../src/server/providers/FastifyAuthPolicyServiceProvider.js";
import { createFakeFastifyPolicyRuntime } from "../../../tooling/testUtils/fakeFastify.mjs";

test("FastifyAuthPolicyServiceProvider registers auth policy plugin through provider boot", async () => {
  const { fastify, state } = createFakeFastifyPolicyRuntime();
  const bag = new Map([
    [KERNEL_TOKENS.Fastify, fastify],
    [KERNEL_TOKENS.Env, { NODE_ENV: "test" }],
    [KERNEL_TOKENS.Logger, console],
    [
      "authService",
      {
        async authenticateRequest() {
          return {
            authenticated: false,
            actor: null,
            transientFailure: false
          };
        }
      }
    ]
  ]);

  const app = {
    has(token) {
      return bag.has(token);
    },
    make(token) {
      if (!bag.has(token)) {
        throw new Error(`Missing token ${String(token)}`);
      }
      return bag.get(token);
    }
  };

  const provider = new FastifyAuthPolicyServiceProvider();
  provider.register(app);
  await provider.boot(app);

  assert.ok(state.requestDecorators.has("user"));
  assert.ok(state.requestDecorators.has("workspace"));
  assert.ok(state.requestDecorators.has("membership"));
  assert.ok(state.requestDecorators.has("permissions"));
  assert.equal(typeof state.preHandler, "function");
  assert.ok(state.registeredPlugins.length >= 3);
});

test("FastifyAuthPolicyServiceProvider wires optional auth policy context resolver", async () => {
  const { fastify, state } = createFakeFastifyPolicyRuntime();
  const bag = new Map([
    [KERNEL_TOKENS.Fastify, fastify],
    [KERNEL_TOKENS.Env, { NODE_ENV: "test" }],
    [KERNEL_TOKENS.Logger, console],
    [
      "authService",
      {
        async authenticateRequest() {
          return {
            authenticated: true,
            actor: { id: 7 },
            transientFailure: false
          };
        }
      }
    ],
    [
      AUTH_POLICY_CONTEXT_RESOLVER_TOKEN,
      async ({ actor, request }) => ({
        workspace: { id: 11, slug: String(request?.params?.workspaceSlug || "").toLowerCase() },
        membership: { roleId: "member" },
        permissions: actor?.id === 7 ? ["projects.read"] : []
      })
    ]
  ]);

  const app = {
    has(token) {
      return bag.has(token);
    },
    make(token) {
      if (!bag.has(token)) {
        throw new Error(`Missing token ${String(token)}`);
      }
      return bag.get(token);
    }
  };

  const provider = new FastifyAuthPolicyServiceProvider();
  provider.register(app);
  await provider.boot(app);

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
  assert.equal(request.workspace?.id, 11);
  assert.equal(request.workspace?.slug, "acme");
  assert.equal(request.membership?.roleId, "member");
  assert.deepEqual(request.permissions, ["projects.read"]);
});
