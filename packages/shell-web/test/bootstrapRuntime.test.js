import assert from "node:assert/strict";
import test from "node:test";
import { createBootstrapPayloadHandlerRegistry } from "../src/client/bootstrap/bootstrapPayloadHandlerRegistry.js";
import { createShellBootstrapRuntime } from "../src/client/runtime/bootstrapRuntime.js";

function createPlacementRuntime(initialContext = {}) {
  let context = Object.freeze({ ...initialContext });
  const listeners = new Set();

  return {
    getContext() {
      return context;
    },
    setContext(value = {}, { replace = false } = {}) {
      const next = value && typeof value === "object" ? { ...value } : {};
      context = Object.freeze(replace ? next : { ...context, ...next });
      for (const listener of listeners) {
        listener({
          type: "context.updated"
        });
      }
      return context;
    },
    subscribe(listener) {
      if (typeof listener === "function") {
        listeners.add(listener);
      }
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

test("shell bootstrap runtime refreshes /api/bootstrap on init and applies registered handlers", async () => {
  const placementRuntime = createPlacementRuntime({
    auth: {}
  });
  const payloads = [
    {
      surfaceAccess: {
        consoleowner: false
      }
    },
    {
      surfaceAccess: {
        consoleowner: true
      }
    }
  ];
  const calls = [];
  const observedRequests = [];
  const observedResolveMeta = [];
  const handlers = createBootstrapPayloadHandlerRegistry();
  handlers.register(Object.freeze({
      handlerId: "test.bootstrap.request",
      order: -10,
      resolveBootstrapRequest() {
        return {
          query: {
            workspaceSlug: "acme"
          },
          meta: {
            path: "/w/acme/dashboard"
          }
        };
      },
      applyBootstrapPayload({ request }) {
        observedRequests.push(request);
      }
    }));
  handlers.register(Object.freeze({
      handlerId: "test.bootstrap.request-meta",
      order: -5,
      resolveBootstrapRequest({ request }) {
        observedResolveMeta.push(request?.meta?.path || "");
        return {};
      },
      applyBootstrapPayload() {}
    }));
  handlers.register(Object.freeze({
      handlerId: "test.bootstrap.surfaceAccess",
      order: 0,
      applyBootstrapPayload({ payload, placementRuntime: targetRuntime }) {
        targetRuntime.setContext({
          surfaceAccess: payload.surfaceAccess || {}
        });
      }
    }));

  const runtime = createShellBootstrapRuntime({
    handlers,
    placementRuntime,
    fetchImplementation: async (url) => {
      calls.push(String(url || ""));
      const payload = payloads.shift() || {};
      return {
        ok: true,
        async json() {
          return payload;
        }
      };
    }
  });

  await runtime.initialize();
  assert.deepEqual(placementRuntime.getContext().surfaceAccess, {
    consoleowner: false
  });
  await runtime.refresh("manual");
  assert.deepEqual(calls, ["/api/bootstrap?workspaceSlug=acme", "/api/bootstrap?workspaceSlug=acme"]);
  assert.deepEqual(observedResolveMeta, ["/w/acme/dashboard", "/w/acme/dashboard"]);
  assert.deepEqual(observedRequests, [
    {
      path: "/api/bootstrap",
      query: {
        workspaceSlug: "acme"
      },
      meta: {
        path: "/w/acme/dashboard"
      }
    },
    {
      path: "/api/bootstrap",
      query: {
        workspaceSlug: "acme"
      },
      meta: {
        path: "/w/acme/dashboard"
      }
    }
  ]);
  assert.deepEqual(placementRuntime.getContext().surfaceAccess, {
    consoleowner: true
  });
});

test("shell bootstrap runtime reports a failing payload handler and keeps refreshing afterwards", async () => {
  const placementRuntime = createPlacementRuntime({});
  const calls = [];
  const handledErrors = [];
  const reported = [];
  let failNextApply = true;
  let failNextResolve = false;
  const handlers = createBootstrapPayloadHandlerRegistry();
  handlers.register(Object.freeze({
    handlerId: "test.bootstrap.flaky",
    order: 0,
    resolveBootstrapRequest() {
      if (failNextResolve) {
        failNextResolve = false;
        throw new Error("resolve failed");
      }
      return {};
    },
    applyBootstrapPayload() {
      if (failNextApply) {
        failNextApply = false;
        throw new Error("apply failed");
      }
    },
    handleBootstrapError({ error, request }) {
      handledErrors.push({ message: error.message, path: request.path });
    }
  }));

  const runtime = createShellBootstrapRuntime({
    handlers,
    placementRuntime,
    requestRecoveryRuntime: {
      report(error, options) {
        reported.push({ message: error.message, source: options.source });
      }
    },
    logger: { warn() {}, info() {}, error() {}, debug() {} },
    fetchImplementation: async (url) => {
      calls.push(String(url || ""));
      return {
        ok: true,
        async json() {
          return { ok: true };
        }
      };
    }
  });

  assert.equal(await runtime.refresh("manual"), null);
  assert.deepEqual(handledErrors, [{ message: "apply failed", path: "/api/bootstrap" }]);
  assert.deepEqual(reported, [{ message: "apply failed", source: "shell-web.bootstrap" }]);

  failNextResolve = true;
  assert.equal(await runtime.refresh("manual"), null);
  assert.deepEqual(handledErrors[1], { message: "resolve failed", path: "/api/bootstrap" });

  assert.deepEqual(await runtime.refresh("manual"), { ok: true });
  assert.deepEqual(calls, ["/api/bootstrap", "/api/bootstrap"]);
});

test("shell bootstrap runtime queue recovers after a refresh rejects", async () => {
  const handlers = createBootstrapPayloadHandlerRegistry();
  let failErrorHandler = true;
  handlers.register(Object.freeze({
    handlerId: "test.bootstrap.error-handler",
    order: 0,
    applyBootstrapPayload() {},
    handleBootstrapError() {
      if (failErrorHandler) {
        failErrorHandler = false;
        throw new Error("error handler failed");
      }
    }
  }));
  let fail = true;
  const runtime = createShellBootstrapRuntime({
    handlers,
    placementRuntime: createPlacementRuntime({}),
    logger: { warn() {}, info() {}, error() {}, debug() {} },
    fetchImplementation: async () => {
      if (fail) {
        fail = false;
        return { ok: false, status: 503 };
      }
      return {
        ok: true,
        async json() {
          return { recovered: true };
        }
      };
    }
  });

  await assert.rejects(runtime.refresh("manual"), /error handler failed/);
  assert.deepEqual(await runtime.refresh("manual"), { recovered: true });
});
