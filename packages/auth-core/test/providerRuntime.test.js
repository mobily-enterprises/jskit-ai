import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
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
    "runtime.env": { APP_ENV: "test" },
    "runtime.fastify": fastify,
    "runtime.logger": silentLogger
  };
}

test("AuthPolicyProvider installs Fastify policy and explicit action/visibility contributors", async () => {
  const { fastify, state } = createFastify();
  const runtime = createCapabilityRuntime({
    inputs: runtimeInputs(fastify),
    providers: [
      EventProvider, ActionProvider,
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
  // Cookies and CSRF; the kernel registers the rate limiter with the routes.
  assert.equal(state.registeredPlugins.length, 2);
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
      EventProvider, ActionProvider,
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
      EventProvider, ActionProvider,
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

test("AuthPolicyProvider checks CSRF on unsafe methods when AUTH_CSRF_UNSAFE_METHODS is unset", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const runtime = createCapabilityRuntime({
    inputs: runtimeInputs(app),
    providers: [
      EventProvider, ActionProvider,
      HttpProvider,
      AuthExtensionsProvider,
      AuthFeature,
      AuthPolicyProvider
    ]
  });
  await runtime.start();
  app.post("/api/write", { config: { authPolicy: "public" } }, () => ({ accepted: true }));

  const missingToken = await app.inject({ method: "POST", url: "/api/write" });
  assert.equal(missingToken.statusCode, 403);
});

/** The Set-Cookie header of the CSRF secret an application started with these env values sends. */
async function csrfSecretCookie(t, env) {
  const app = Fastify();
  t.after(() => app.close());
  const runtime = createCapabilityRuntime({
    inputs: { ...runtimeInputs(app), "runtime.env": { APP_ENV: "test", ...env } },
    providers: [EventProvider, ActionProvider, HttpProvider, AuthExtensionsProvider, AuthFeature, AuthPolicyProvider]
  });
  await runtime.start();
  app.get("/api/csrf", { config: { authPolicy: "public" } }, (_request, reply) => ({ token: reply.generateCsrf() }));
  const response = await app.inject({ method: "GET", url: "/api/csrf" });
  return [].concat(response.headers["set-cookie"]).find((cookie) => cookie.startsWith("_csrf="));
}

test("the CSRF cookie is SameSite=Lax unless AUTH_COOKIE_SAME_SITE is strict, and another value stops startup", async (t) => {
  assert.match(await csrfSecretCookie(t, {}), /; SameSite=Lax(;|$)/u);
  assert.match(await csrfSecretCookie(t, { AUTH_COOKIE_SAME_SITE: "" }), /; SameSite=Lax(;|$)/u);
  assert.match(await csrfSecretCookie(t, { AUTH_COOKIE_SAME_SITE: "strict" }), /; SameSite=Strict(;|$)/u);
  for (const value of ["none", "Strict;"]) {
    await assert.rejects(csrfSecretCookie(t, { AUTH_COOKIE_SAME_SITE: value }), {
      message: `AUTH_COOKIE_SAME_SITE must be lax or strict, not "${value}".`
    });
  }
});
