import assert from "node:assert/strict";
import test from "node:test";

import { resolveScopedApiBasePath } from "../../../shared/surface/apiPaths.js";
import { createActionRouteScope } from "../index.js";
import { createRouter } from "./router.js";

function httpWithRouter() {
  return { router: createRouter() };
}

function routeRequest(overrides = {}) {
  const calls = [];
  return {
    calls,
    request: {
      params: { sessionId: "s1" },
      async executeAction(payload) {
        calls.push(payload);
        return { ok: true, payload };
      },
      ...overrides
    }
  };
}

test("the scope base path is the scoped API base path the kernel resolves", () => {
  const http = httpWithRouter();
  const scope = createActionRouteScope(http, { routeBase: "/app/:slug", relativePath: "vibe64", surface: "App" });
  assert.equal(scope.routeBase, resolveScopedApiBasePath({ routeBase: "/app/:slug", relativePath: "vibe64", strictParams: false }));
  assert.equal(scope.routeBase, "/api/app/:slug/vibe64");
  assert.equal(createActionRouteScope(http).routeBase, resolveScopedApiBasePath({ routeBase: "/", relativePath: "", strictParams: false }));
  assert.throws(() => createActionRouteScope(http, { routeBase: "/app/:slug", strictParams: true }), /missing required route params: slug/u);
});

test("action routes record their action id and run it with the built input", async () => {
  const http = httpWithRouter();
  const scope = createActionRouteScope(http, { routeBase: "/app/:slug", relativePath: "vibe64", surface: "App" });
  scope.actionRoute("GET", "/sessions/:sessionId/status", {
    actionId: "vibe64.sessions.status.read",
    buildInput: (request) => ({ sessionId: request.params.sessionId }),
    meta: { summary: "Read session status." }
  });
  scope.actionRoute("post", "/sessions", { actionId: "vibe64.sessions.create" });
  scope.serviceRoute("GET", "/stream", { auth: "public" }, async () => "streamed");

  const [status, create, stream] = http.router.list();
  assert.deepEqual(
    http.router.list().map(({ method, path, actionId, surface }) => ({ method, path, actionId, surface })),
    [
      { method: "GET", path: "/api/app/:slug/vibe64/sessions/:sessionId/status", actionId: "vibe64.sessions.status.read", surface: "app" },
      { method: "POST", path: "/api/app/:slug/vibe64/sessions", actionId: "vibe64.sessions.create", surface: "app" },
      { method: "GET", path: "/api/app/:slug/vibe64/stream", actionId: "", surface: "app" }
    ]
  );

  const statusCall = routeRequest();
  assert.deepEqual(await status.handler(statusCall.request, {}), {
    ok: true,
    payload: { actionId: "vibe64.sessions.status.read", input: { sessionId: "s1" } }
  });
  const createCall = routeRequest();
  await create.handler(createCall.request, {});
  assert.deepEqual(createCall.calls, [{ actionId: "vibe64.sessions.create", input: {} }]);
  assert.equal(await stream.handler(routeRequest().request, {}), "streamed");
});

test("routes without an action id keep an empty action id", () => {
  const router = createRouter();
  router.register("GET", "/plain", {}, () => null);
  router.register("GET", "/named", { actionId: "  named.read  " }, () => null);
  assert.deepEqual(router.list().map((route) => route.actionId), ["", "named.read"]);
});

test("wrapHandler wraps action and service routes with their registration facts", async () => {
  const http = httpWithRouter();
  const wrapped = [];
  const scope = createActionRouteScope(http, {
    relativePath: "/tools",
    wrapHandler(handler, facts) {
      wrapped.push(facts);
      return async (request, reply) => ({ wrapped: await handler(request, reply) });
    }
  });
  scope.actionRoute("DELETE", "/items/:id", { actionId: "tools.items.delete", buildInput: (request) => ({ id: request.params.id }) });
  scope.serviceRoute("POST", "/upload", { bodyLimit: 1024 }, async () => "stored");

  assert.deepEqual(wrapped.map(({ method, path, options }) => ({ method, path, actionId: options.actionId, bodyLimit: options.bodyLimit })), [
    { method: "DELETE", path: "/api/tools/items/:id", actionId: "tools.items.delete", bodyLimit: undefined },
    { method: "POST", path: "/api/tools/upload", actionId: undefined, bodyLimit: 1024 }
  ]);
  const [remove, upload] = http.router.list();
  const call = routeRequest({ params: { id: "7" } });
  assert.deepEqual(await remove.handler(call.request, {}), { wrapped: { ok: true, payload: { actionId: "tools.items.delete", input: { id: "7" } } } });
  assert.deepEqual(await upload.handler(routeRequest().request, {}), { wrapped: "stored" });
});

test("the scope refuses a missing router, action id or handler", () => {
  assert.throws(() => createActionRouteScope({}), /runtime\.http with router\.register/u);
  const scope = createActionRouteScope(httpWithRouter());
  assert.throws(() => scope.actionRoute("GET", "/x", {}), /actionRoute requires an actionId/u);
  assert.throws(() => scope.serviceRoute("GET", "/x", {}, null), /requires a handler function/u);
  assert.throws(() => createActionRouteScope(httpWithRouter(), { wrapHandler: "no" }), /wrapHandler must be a function/u);
});
