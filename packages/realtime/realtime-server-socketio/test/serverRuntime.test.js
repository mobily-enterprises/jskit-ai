import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  __testables,
  registerRealtimeServerSocketio,
  SOCKET_IO_PATH
} from "../src/index.js";

function createFastifyStub() {
  const hooks = {
    onClose: []
  };

  return {
    server: http.createServer(),
    hooks,
    addHook(name, handler) {
      if (!hooks[name]) {
        hooks[name] = [];
      }
      hooks[name].push(handler);
    }
  };
}

function createRequiredDeps(overrides = {}) {
  return {
    authService: {
      async authenticateRequest() {
        return {
          authenticated: true,
          profile: {
            id: 7,
            email: "user@example.com"
          },
          transientFailure: false
        };
      }
    },
    realtimeEventsService: {
      subscribe() {
        return () => {};
      }
    },
    workspaceService: {
      async resolveRequestContext({ request }) {
        const workspaceSlug = String(request?.headers?.["x-workspace-slug"] || "").trim();
        return {
          workspace: workspaceSlug
            ? {
                id: 11,
                slug: workspaceSlug
              }
            : null,
          permissions: ["projects.read"]
        };
      }
    },
    isSupportedTopic(topic) {
      return String(topic || "").trim() === "projects";
    },
    isTopicAllowedForSurface(topic, surface) {
      if (String(topic || "").trim() !== "projects") {
        return false;
      }

      const normalizedSurface = String(surface || "")
        .trim()
        .toLowerCase();
      return normalizedSurface === "app" || normalizedSurface === "admin";
    },
    hasTopicPermission(topic, permissions) {
      if (String(topic || "").trim() !== "projects") {
        return false;
      }

      const permissionList = Array.isArray(permissions) ? permissions : [];
      return permissionList.includes("projects.read");
    },
    buildSubscribeContextRequest(baseRequest, workspaceSlug, surfaceId) {
      return {
        ...baseRequest,
        headers: {
          ...(baseRequest?.headers || {}),
          "x-workspace-slug": String(workspaceSlug || "").trim(),
          "x-surface-id": String(surfaceId || "")
            .trim()
            .toLowerCase()
        }
      };
    },
    normalizeConnectionSurface(value) {
      const normalized = String(value || "")
        .trim()
        .toLowerCase();
      return normalized || "app";
    },
    normalizeWorkspaceSlug(value) {
      return String(value || "").trim();
    },
    ...overrides
  };
}

test("redis timeout helpers normalize bounds", () => {
  assert.equal(__testables.normalizeRedisQuitTimeoutMs(0, 900), 900);
  assert.equal(__testables.normalizeRedisQuitTimeoutMs(50, 900), 50);
  assert.equal(__testables.normalizeRedisQuitTimeoutMs(1200, 900), 1200);
  assert.equal(__testables.normalizeRedisQuitTimeoutMs(90_000, 900), 60_000);

  assert.equal(__testables.normalizeRedisConnectTimeoutMs(0, 900), 900);
  assert.equal(__testables.normalizeRedisConnectTimeoutMs(50, 900), 50);
  assert.equal(__testables.normalizeRedisConnectTimeoutMs(1200, 900), 1200);
  assert.equal(__testables.normalizeRedisConnectTimeoutMs(90_000, 900), 60_000);
});

test("redis close helper falls back to disconnect when quit stalls", async () => {
  let disconnectCalls = 0;
  const redisClient = {
    isOpen: true,
    async quit() {
      return new Promise(() => {});
    },
    disconnect() {
      disconnectCalls += 1;
      this.isOpen = false;
    }
  };

  const startedAtMs = Date.now();
  await __testables.closeRedisClientWithTimeout(redisClient, { timeoutMs: 25 });
  const elapsedMs = Date.now() - startedAtMs;

  assert.equal(disconnectCalls, 1);
  assert.ok(elapsedMs < 250);
});

test("registers server runtime and tears down listener on close hook", async () => {
  const fastify = createFastifyStub();
  let unsubscribed = false;

  const deps = createRequiredDeps({
    realtimeEventsService: {
      subscribe() {
        return () => {
          unsubscribed = true;
        };
      }
    }
  });

  const io = await registerRealtimeServerSocketio(fastify, {
    ...deps,
    path: SOCKET_IO_PATH
  });

  assert.ok(io);
  assert.equal(Array.isArray(fastify.hooks.onClose), true);
  assert.ok(fastify.hooks.onClose.length >= 1);

  for (const onClose of fastify.hooks.onClose) {
    await onClose();
  }

  assert.equal(unsubscribed, true);
});

