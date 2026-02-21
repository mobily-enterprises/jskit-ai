import Fastify from "fastify";
import { io as createSocketIoClient } from "socket.io-client";

import { createService as createRealtimeEventsService } from "../../server/domain/realtime/services/events.service.js";
import {
  registerSocketIoRealtime,
  SOCKET_IO_MESSAGE_EVENT,
  SOCKET_IO_PATH
} from "../../server/realtime/registerSocketIoRealtime.js";

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

function createRealtimeTestWorkspaceService({
  permissionsBySlug,
  appDenyUserIdsBySlug,
  appDenyEmailsBySlug,
  onResolve
} = {}) {
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
      const denyEmails = Array.isArray(denyEmailsMap[workspaceSlug])
        ? denyEmailsMap[workspaceSlug].map(normalizeEmail)
        : [];
      const appDenied =
        surfaceId === "app" && (denyUserIds.includes(userId) || (userEmail && denyEmails.includes(userEmail)));
      if (!permissions || appDenied) {
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

async function createRealtimeTestApp({
  permissionsBySlug,
  appDenyUserIdsBySlug,
  appDenyEmailsBySlug,
  workspaceService,
  requireRedisAdapter = false
} = {}) {
  const app = Fastify();
  installRealtimeTestErrorHandler(app);

  const effectiveWorkspaceService =
    workspaceService ||
    createRealtimeTestWorkspaceService({
      permissionsBySlug,
      appDenyUserIdsBySlug,
      appDenyEmailsBySlug
    });
  const realtimeEventsService = createRealtimeEventsService();

  await registerSocketIoRealtime(app, {
    authService: createRealtimeTestAuthService(),
    realtimeEventsService,
    workspaceService: effectiveWorkspaceService,
    redisUrl: "",
    requireRedisAdapter
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  const port = Number(address?.port || 0);

  return {
    app,
    port,
    workspaceService: effectiveWorkspaceService,
    realtimeEventsService
  };
}

function coerceHttpUrl(urlValue) {
  const source = String(urlValue || "").trim();
  if (!source) {
    return "";
  }

  if (source.startsWith("ws://")) {
    return `http://${source.slice(5)}`;
  }
  if (source.startsWith("wss://")) {
    return `https://${source.slice(6)}`;
  }

  return source;
}

function resolveSocketConnectionOptions(url, options = {}) {
  const parsedUrl = new URL(coerceHttpUrl(url));
  const query = {};
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    query[key] = value;
  }

  return {
    baseUrl: `${parsedUrl.protocol}//${parsedUrl.host}`,
    path: parsedUrl.pathname || SOCKET_IO_PATH,
    query,
    extraHeaders: options?.headers && typeof options.headers === "object" ? { ...options.headers } : undefined
  };
}

function openRealtimeWebSocket(url, options = {}) {
  const connectionOptions = resolveSocketConnectionOptions(url, options);

  return new Promise((resolve, reject) => {
    const socket = createSocketIoClient(connectionOptions.baseUrl, {
      path: connectionOptions.path,
      query: connectionOptions.query,
      transports: ["websocket"],
      reconnection: false,
      timeout: 4000,
      autoConnect: false,
      extraHeaders: connectionOptions.extraHeaders
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error("Timed out waiting for websocket open."));
    }, 4000);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };

    const onConnect = () => {
      cleanup();

      // Provide a ws-like send adapter for existing tests.
      socket.send = (payload) => {
        let parsedPayload = payload;
        if (typeof payload === "string") {
          parsedPayload = JSON.parse(payload);
        }
        socket.emit(SOCKET_IO_MESSAGE_EVENT, parsedPayload);
      };

      resolve(socket);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
    socket.connect();
  });
}

function waitForRealtimeMessage(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(SOCKET_IO_MESSAGE_EVENT, onMessage);
      socket.off("connect_error", onError);
      reject(new Error("Timed out waiting for websocket message."));
    }, 4000);

    const onMessage = (payload) => {
      clearTimeout(timeout);
      socket.off("connect_error", onError);
      resolve(payload);
    };

    const onError = (error) => {
      clearTimeout(timeout);
      socket.off(SOCKET_IO_MESSAGE_EVENT, onMessage);
      reject(error);
    };

    socket.once(SOCKET_IO_MESSAGE_EVENT, onMessage);
    socket.once("connect_error", onError);
  });
}

function waitForRealtimeClose(socket) {
  return new Promise((resolve) => {
    socket.once("disconnect", (reason) => {
      resolve(String(reason || ""));
    });
  });
}

function waitForOptionalRealtimeMessage(socket, timeoutMs = 600) {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      socket.off(SOCKET_IO_MESSAGE_EVENT, onMessage);
      socket.off("disconnect", onClose);
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

    const onMessage = (payload) => {
      settle(payload);
    };

    const onClose = () => {
      settle(null);
    };

    const timeout = setTimeout(() => {
      settle(null);
    }, timeoutMs);

    socket.on(SOCKET_IO_MESSAGE_EVENT, onMessage);
    socket.on("disconnect", onClose);
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
