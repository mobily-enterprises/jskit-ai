import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel/_testable";
import { ActionRuntimeServiceProvider } from "@jskit-ai/kernel/server/actions";
import { AccessCoreServiceProvider } from "../src/server/providers/AccessCoreServiceProvider.js";
import { AuthActionsServiceProvider } from "../src/server/providers/AuthActionsServiceProvider.js";
import { FastifyAuthPolicyServiceProvider } from "../src/server/providers/FastifyAuthPolicyServiceProvider.js";
import { AUTH_POLICY_CONTEXT_RESOLVER_TAG } from "../src/server/authPolicyContextResolverRegistry.js";
import { createFakeFastifyPolicyRuntime } from "../../../tooling/testUtils/fakeFastify.mjs";

test("FastifyAuthPolicyServiceProvider registers auth policy plugin through provider boot", async () => {
  const { fastify, state } = createFakeFastifyPolicyRuntime();
  const bag = new Map([
    ["jskit.fastify", fastify],
    ["jskit.env", { NODE_ENV: "test" }],
    ["jskit.logger", console],
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
  const makeCalls = [];
  const resolveTagCalls = [];
  const bag = new Map([
    ["jskit.fastify", fastify],
    ["jskit.env", { NODE_ENV: "test" }],
    ["jskit.logger", console],
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
    ]
  ]);

  const app = {
    has(token) {
      return bag.has(token);
    },
    make(token) {
      makeCalls.push(String(token));
      if (!bag.has(token)) {
        throw new Error(`Missing token ${String(token)}`);
      }
      return bag.get(token);
    },
    resolveTag(tag) {
      resolveTagCalls.push(String(tag));
      if (tag !== AUTH_POLICY_CONTEXT_RESOLVER_TAG) {
        return [];
      }

      return [
        {
          resolverId: "workspace",
          order: 10,
          async resolveAuthPolicyContext({ actor, request }) {
            return {
              workspace: { id: 11, slug: String(request?.params?.workspaceSlug || "").toLowerCase() },
              membership: { roleSid: "member" },
              permissions: actor?.id === 7 ? ["projects.read"] : []
            };
          }
        },
        async () => ({
          permissions: ["settings.manage"]
        })
      ];
    }
  };

  const provider = new FastifyAuthPolicyServiceProvider();
  provider.register(app);
  await provider.boot(app);

  assert.deepEqual(makeCalls, ["jskit.env", "jskit.fastify"]);
  assert.deepEqual(resolveTagCalls, []);

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
  assert.ok(makeCalls.includes("authService"));
  assert.deepEqual(resolveTagCalls, [AUTH_POLICY_CONTEXT_RESOLVER_TAG]);
  assert.equal(request.workspace?.id, 11);
  assert.equal(request.workspace?.slug, "acme");
  assert.equal(request.membership?.roleSid, "member");
  assert.deepEqual(request.permissions, ["settings.manage", "projects.read"]);
});

test("auth-core providers boot without a selected provider and deny protected API requests", async () => {
  const { fastify, state } = createFakeFastifyPolicyRuntime();
  const app = createApplication();

  app.instance("appConfig", {
    surfaceModeAll: "all",
    surfaceDefaultId: "home",
    surfaceDefinitions: {
      home: { id: "home", pagesRoot: "", enabled: true, requiresAuth: false, requiresWorkspace: false }
    }
  });
  app.instance("jskit.fastify", fastify);
  app.instance("jskit.env", { NODE_ENV: "test" });

  await app.start({
    providers: [
      ActionRuntimeServiceProvider,
      AccessCoreServiceProvider,
      AuthActionsServiceProvider,
      FastifyAuthPolicyServiceProvider
    ]
  });

  const request = {
    method: "GET",
    raw: { url: "/api/protected" },
    routeOptions: {
      config: {
        authPolicy: "required"
      }
    }
  };

  await assert.rejects(
    () => state.preHandler(request, {}),
    /Authentication required/
  );
});
