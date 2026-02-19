import Fastify from "fastify";
import WebSocket from "ws";
import fastifyWebsocket from "@fastify/websocket";

import authPlugin from "../../server/fastify/auth.plugin.js";
import { createService as createRealtimeEventsService } from "../../server/domain/realtime/services/events.service.js";
import { registerRealtimeRoutes } from "../../server/fastify/registerRealtimeRoutes.js";

function installRealtimeTestErrorHandler(app) {
  app.setErrorHandler((error, _request, reply) => {
    const status = Number(error?.statusCode || error?.status || 500);
    reply.code(status).send({
      error: String(error?.message || "Request failed.")
    });
  });
}

function createRealtimeTestAuthService() {
  return {
    async authenticateRequest(request) {
      const cookieHeader = String(request?.headers?.cookie || "");
      const authenticated = cookieHeader.includes("sid=ok");

      return {
        authenticated,
        profile: authenticated
          ? {
              id: 7,
              email: "user@example.com"
            }
          : null,
        clearSession: false,
        session: null,
        transientFailure: false
      };
    },
    writeSessionCookies() {},
    clearSessionCookies() {}
  };
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function createRealtimeTestWorkspaceService({ permissionsBySlug, appDenyUserIdsBySlug, appDenyEmailsBySlug, onResolve } = {}) {
  const calls = [];
  const permissionsMap =
    permissionsBySlug && typeof permissionsBySlug === "object"
      ? permissionsBySlug
      : {
          acme: ["projects.read", "workspace.settings.view", "workspace.members.view"]
        };
  const denyUserIdsMap = appDenyUserIdsBySlug && typeof appDenyUserIdsBySlug === "object" ? appDenyUserIdsBySlug : {};
  const denyEmailsMap = appDenyEmailsBySlug && typeof appDenyEmailsBySlug === "object" ? appDenyEmailsBySlug : {};

  return {
    calls,
    async resolveRequestContext({ user, request }) {
      const surfaceId = String(request?.headers?.["x-surface-id"] || "")
        .trim()
        .toLowerCase();
      const userId = Number(user?.id || 0);
      const userEmail = normalizeEmail(user?.email);
      const callRecord = {
        userId,
        surfaceId,
        headers: { ...(request?.headers || {}) },
        params: { ...(request?.params || {}) },
        query: { ...(request?.query || {}) }
      };
      calls.push(callRecord);
      if (typeof onResolve === "function") {
        onResolve(callRecord);
      }

      const workspaceSlug = String(request?.headers?.["x-workspace-slug"] || "").trim();
      const permissions = Array.isArray(permissionsMap[workspaceSlug]) ? permissionsMap[workspaceSlug] : null;
      const denyUserIds = Array.isArray(denyUserIdsMap[workspaceSlug]) ? denyUserIdsMap[workspaceSlug] : [];
      const denyEmails = Array.isArray(denyEmailsMap[workspaceSlug]) ? denyEmailsMap[workspaceSlug].map(normalizeEmail) : [];
      const appDenied = surfaceId === "app" && (denyUserIds.includes(userId) || (userEmail && denyEmails.includes(userEmail)));
      if (!permissions) {
        return {
          workspace: null,
          membership: null,
          permissions: [],
          workspaces: [],
          userSettings: null
        };
      }
      if (appDenied) {
        return {
          workspace: null,
          membership: null,
          permissions: [],
          workspaces: [],
          userSettings: null
        };
      }

      return {
        workspace: {
          id: 11,
          slug: workspaceSlug
        },
        membership: {
          roleId: "member"
        },
        permissions,
        workspaces: [],
        userSettings: null
      };
    }
  };
}

async function createRealtimeTestApp({ permissionsBySlug, appDenyUserIdsBySlug, appDenyEmailsBySlug, workspaceService } = {}) {
  const app = Fastify();
  installRealtimeTestErrorHandler(app);

  const effectiveWorkspaceService =
    workspaceService ||
    createRealtimeTestWorkspaceService({
      permissionsBySlug,
      appDenyUserIdsBySlug,
      appDenyEmailsBySlug
    });

  await app.register(authPlugin, {
    authService: createRealtimeTestAuthService(),
    workspaceService: effectiveWorkspaceService,
    nodeEnv: "test"
  });
  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: 8192
    }
  });

  registerRealtimeRoutes(app, {
    realtimeEventsService: createRealtimeEventsService(),
    workspaceService: effectiveWorkspaceService
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  const port = Number(address?.port || 0);

  return {
    app,
    port,
    workspaceService: effectiveWorkspaceService
  };
}

function openRealtimeWebSocket(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("Timed out waiting for websocket open."));
    }, 4000);

    socket.once("open", () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForRealtimeMessage(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for websocket message."));
    }, 4000);

    socket.once("message", (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(data)));
    });

    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForRealtimeClose(socket) {
  return new Promise((resolve) => {
    socket.once("close", (code) => {
      resolve(code);
    });
  });
}

function waitForOptionalRealtimeMessage(socket, timeoutMs = 600) {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
      clearTimeout(timeout);
    };

    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const onMessage = (data) => {
      try {
        settle(JSON.parse(String(data)));
      } catch {
        settle(null);
      }
    };

    const onClose = () => {
      settle(null);
    };

    const timeout = setTimeout(() => {
      settle(null);
    }, timeoutMs);

    socket.on("message", onMessage);
    socket.on("close", onClose);
  });
}

export {
  createRealtimeTestApp,
  createRealtimeTestWorkspaceService,
  openRealtimeWebSocket,
  waitForRealtimeMessage,
  waitForRealtimeClose,
  waitForOptionalRealtimeMessage
};
