import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { registerRoutes } from "../src/server/registerRoutes.js";
import { createChatService } from "../src/server/services/chatService.js";

function createAssistantAppConfig() {
  return {
    surfaceDefinitions: {
      admin: {
        id: "admin",
        enabled: true,
        requiresWorkspace: true,
        accessPolicyId: "workspace_member"
      }
    },
    assistantSurfaces: {
      admin: {
        settingsSurfaceId: "admin",
        configScope: "workspace"
      }
    }
  };
}

test("registerRoutes resolves appConfig lazily when handlers run", async () => {
  const routes = [];
  let currentAppConfig = null;

  const router = {
    register(method, path, options, handler) {
      routes.push({ method, path, options, handler });
    }
  };

  const app = {
    make(token) {
      if (token === "jskit.http.router") {
        return router;
      }
      if (token === "appConfig") {
        return currentAppConfig;
      }
      throw new Error(`Unexpected token: ${token}`);
    },
    has(token) {
      return token === "appConfig" ? Boolean(currentAppConfig) : token === "jskit.http.router";
    }
  };

  registerRoutes(app);
  currentAppConfig = createAssistantAppConfig();

  const route = routes.find(
    (entry) =>
      entry.method === "GET" &&
      entry.path === "/api/w/:workspaceSlug/assistant/:surfaceId/conversations"
  );

  assert.ok(route, "Expected workspace assistant conversations route to be registered.");

  let capturedInput = null;
  const reply = {
    statusCode: 0,
    payload: null,
    code(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    }
  };

  await route.handler(
    {
      headers: {
        "x-jskit-surface": "admin"
      },
      input: {
        params: {
          workspaceSlug: "dogandgroom",
          surfaceId: "admin"
        },
        query: {
          limit: 20
        }
      },
      executeAction: async ({ input }) => {
        capturedInput = input;
        return {
          entries: [],
          pagination: {
            cursor: null,
            nextCursor: null,
            limit: 20,
            hasMore: false
          }
        };
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.equal(capturedInput?.targetSurfaceId, "admin");
  assert.equal(capturedInput?.workspaceSlug, "dogandgroom");
});

test("registerRoutes returns clear AppError payload for pre-stream assistant failures", async () => {
  const routes = [];
  let currentAppConfig = null;

  const router = {
    register(method, path, options, handler) {
      routes.push({ method, path, options, handler });
    }
  };

  const app = {
    make(token) {
      if (token === "jskit.http.router") {
        return router;
      }
      if (token === "appConfig") {
        return currentAppConfig;
      }
      throw new Error(`Unexpected token: ${token}`);
    },
    has(token) {
      return token === "appConfig" ? Boolean(currentAppConfig) : token === "jskit.http.router";
    }
  };

  registerRoutes(app);
  currentAppConfig = createAssistantAppConfig();

  const route = routes.find(
    (entry) =>
      entry.method === "POST" &&
      entry.path === "/api/w/:workspaceSlug/assistant/:surfaceId/chat/stream"
  );

  assert.ok(route, "Expected workspace assistant chat stream route to be registered.");

  const reply = {
    statusCode: 0,
    payload: null,
    code(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
    header() {
      return this;
    }
  };

  await route.handler(
    {
      raw: {
        on() {},
        off() {}
      },
      headers: {
        "x-jskit-surface": "admin"
      },
      input: {
        params: {
          workspaceSlug: "dogandgroom",
          surfaceId: "admin"
        },
        body: {
          messageId: "msg_1",
          input: "hello",
          history: []
        }
      },
      executeAction: async () => {
        throw new AppError(503, "Assistant provider is not configured.");
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 503);
  assert.deepEqual(reply.payload, {
    error: "Assistant provider is not configured.",
    code: "APP_ERROR"
  });
});

test("chat service resolves appConfig lazily when conversations are listed", async () => {
  let currentAppConfig = {};

  const chatService = createChatService({
    aiClientFactory: {
      resolveClient() {
        throw new Error("resolveClient should not be called when listing conversations.");
      }
    },
    transcriptService: {
      async listConversationsForUser(assistantSurface, workspace, actor, query, options = {}) {
        return {
          assistantSurface,
          workspace,
          actor,
          query,
          options
        };
      }
    },
    serviceToolCatalog: {},
    assistantConfigService: {},
    resolveAppConfig: () => currentAppConfig
  });

  currentAppConfig = createAssistantAppConfig();

  const response = await chatService.listConversations(
    {
      limit: 20
    },
    {
      input: {
        targetSurfaceId: "admin",
        workspaceSlug: "dogandgroom"
      },
      context: {
        actor: {
          authenticated: true,
          userId: 42
        },
        workspace: {
          id: 7,
          slug: "dogandgroom"
        }
      }
    }
  );

  assert.equal(response.assistantSurface.targetSurfaceId, "admin");
  assert.equal(response.workspace.slug, "dogandgroom");
});
