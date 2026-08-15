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
