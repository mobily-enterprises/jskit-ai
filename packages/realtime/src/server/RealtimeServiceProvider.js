import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  registerDomainEventListener,
  resolveServiceRegistrations
} from "@jskit-ai/kernel/server/runtime";
import {
  createSocketIoServer,
  closeSocketIoServer,
  resolveRealtimeRedisUrl,
  configureSocketIoRedisAdapter,
  closeSocketIoRedisConnections
} from "./runtime.js";
import {
  REALTIME_RUNTIME_SERVER_TOKEN,
  REALTIME_SOCKET_IO_SERVER_TOKEN
} from "./tokens.js";

const REALTIME_RUNTIME_SERVER_API = Object.freeze({
  createSocketIoServer,
  closeSocketIoServer
});
const REALTIME_DOMAIN_EVENT_BRIDGE_TOKEN = "runtime.realtime.domain-event-bridge";

const REALTIME_ROOM_ALL_CLIENTS = "clients";
const REALTIME_ROOM_ALL_USERS = "users";

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }
  return parsed;
}

function normalizeArray(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const list = [];

  while (queue.length > 0) {
    const entry = queue.shift();
    if (Array.isArray(entry)) {
      queue.push(...entry);
      continue;
    }
    if (entry == null) {
      continue;
    }
    list.push(entry);
  }

  return list;
}

function roomForUser(userId) {
  return `user:${Number(userId)}`;
}

function roomForWorkspace(workspaceId) {
  return `workspace:${Number(workspaceId)}`;
}

function roomForWorkspaceUser(workspaceId, userId) {
  return `workspace:${Number(workspaceId)}:user:${Number(userId)}`;
}

function parseCookieHeader(value = "") {
  const source = String(value || "").trim();
  if (!source) {
    return {};
  }

  return source.split(";").reduce((cookies, entry) => {
    const separator = entry.indexOf("=");
    if (separator < 1) {
      return cookies;
    }
    const key = entry.slice(0, separator).trim();
    const rawValue = entry.slice(separator + 1).trim();
    if (!key) {
      return cookies;
    }

    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
    return cookies;
  }, {});
}

function createProviderLogger(scope) {
  const logger =
    scope && typeof scope.has === "function" && scope.has(KERNEL_TOKENS.Logger) ? scope.make(KERNEL_TOKENS.Logger) : null;

  return Object.freeze({
    info: (...args) => {
      if (logger && typeof logger.info === "function") {
        logger.info(...args);
        return;
      }
      console.info(...args);
    },
    warn: (...args) => {
      if (logger && typeof logger.warn === "function") {
        logger.warn(...args);
        return;
      }
      console.warn(...args);
    },
    error: (...args) => {
      if (logger && typeof logger.error === "function") {
        logger.error(...args);
        return;
      }
      console.error(...args);
    }
  });
}

function buildRealtimeDispatchIndex(registrations = []) {
  const index = new Map();

  for (const registration of registrations) {
    const serviceToken = String(registration?.serviceToken || "").trim();
    if (!serviceToken) {
      continue;
    }

    const eventsByMethod = registration?.metadata?.events;
    if (!eventsByMethod || typeof eventsByMethod !== "object" || Array.isArray(eventsByMethod)) {
      continue;
    }

    for (const [methodName, specs] of Object.entries(eventsByMethod)) {
      const normalizedMethodName = String(methodName || "").trim();
      if (!normalizedMethodName) {
        continue;
      }
      const key = `${serviceToken}:${normalizedMethodName}`;
      const list = [];
      const entries = Array.isArray(specs) ? specs : [];

      for (const spec of entries) {
        const realtime = spec?.realtime;
        const event = normalizeText(realtime?.event);
        if (!event) {
          continue;
        }
        list.push(
          Object.freeze({
            event,
            payload: typeof realtime.payload === "function" ? realtime.payload : null,
            audience: realtime?.audience
          })
        );
      }

      if (list.length > 0) {
        index.set(key, Object.freeze(list));
      }
    }
  }

  return index;
}

function resolveScopeWorkspaceId(scope = {}) {
  const source = scope && typeof scope === "object" && !Array.isArray(scope) ? scope : {};
  if (String(source.kind || "").trim().toLowerCase() === "workspace") {
    return toPositiveInteger(source.id);
  }
  if (String(source.kind || "").trim().toLowerCase() === "workspace_user") {
    return toPositiveInteger(source.workspaceId || source.id);
  }
  return toPositiveInteger(source.workspaceId);
}

function resolveScopeUserId(scope = {}) {
  const source = scope && typeof scope === "object" && !Array.isArray(scope) ? scope : {};
  if (String(source.kind || "").trim().toLowerCase() === "user") {
    return toPositiveInteger(source.id);
  }
  if (String(source.kind || "").trim().toLowerCase() === "workspace_user") {
    return toPositiveInteger(source.userId);
  }
  return toPositiveInteger(source.userId);
}

function applyAudiencePreset(preset, { event, rooms, flags, logger } = {}) {
  const normalizedPreset = normalizeText(preset).toLowerCase();
  if (!normalizedPreset || normalizedPreset === "none") {
    return;
  }

  if (normalizedPreset === "all_clients") {
    flags.broadcastAllClients = true;
    return;
  }

  if (normalizedPreset === "all_users") {
    rooms.add(REALTIME_ROOM_ALL_USERS);
    return;
  }

  if (normalizedPreset === "actor_user") {
    const actorId = toPositiveInteger(event?.actorId);
    if (actorId > 0) {
      rooms.add(roomForUser(actorId));
    }
    return;
  }

  if (normalizedPreset === "all_workspace_users") {
    const workspaceId = resolveScopeWorkspaceId(event?.scope);
    if (workspaceId > 0) {
      rooms.add(roomForWorkspace(workspaceId));
      return;
    }
    logger.warn(
      {
        audience: normalizedPreset,
        scope: event?.scope || null
      },
      "Realtime audience preset requires a workspace scope."
    );
    return;
  }

  if (normalizedPreset === "event_scope") {
    const scopeKind = normalizeText(event?.scope?.kind).toLowerCase();
    if (scopeKind === "workspace") {
      const workspaceId = resolveScopeWorkspaceId(event?.scope);
      if (workspaceId > 0) {
        rooms.add(roomForWorkspace(workspaceId));
      }
      return;
    }
    if (scopeKind === "workspace_user") {
      const workspaceId = resolveScopeWorkspaceId(event?.scope);
      const userId = resolveScopeUserId(event?.scope);
      if (workspaceId > 0 && userId > 0) {
        rooms.add(roomForWorkspaceUser(workspaceId, userId));
      }
      return;
    }
    if (scopeKind === "user") {
      const userId = resolveScopeUserId(event?.scope);
      if (userId > 0) {
        rooms.add(roomForUser(userId));
      }
      return;
    }
    rooms.add(REALTIME_ROOM_ALL_USERS);
    return;
  }

  logger.warn(
    {
      audience: normalizedPreset
    },
    "Realtime bridge ignored unknown audience preset."
  );
}

function addAudienceRoomsFromObject(selection, { event, rooms, flags, logger } = {}) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return;
  }

  if (Object.hasOwn(selection, "preset")) {
    applyAudiencePreset(selection.preset, {
      event,
      rooms,
      flags,
      logger
    });
  }
  if (selection.broadcast === true) {
    flags.broadcastAllClients = true;
  }

  const room = normalizeText(selection.room);
  if (room) {
    rooms.add(room);
  }
  for (const entry of normalizeArray(selection.rooms)) {
    const normalizedRoom = normalizeText(entry);
    if (normalizedRoom) {
      rooms.add(normalizedRoom);
    }
  }

  const userId = toPositiveInteger(selection.userId);
  if (userId > 0) {
    rooms.add(roomForUser(userId));
  }
  for (const entry of normalizeArray(selection.userIds)) {
    const normalizedUserId = toPositiveInteger(entry);
    if (normalizedUserId > 0) {
      rooms.add(roomForUser(normalizedUserId));
    }
  }

  const workspaceId = toPositiveInteger(selection.workspaceId);
  if (workspaceId > 0) {
    rooms.add(roomForWorkspace(workspaceId));
  }
  for (const entry of normalizeArray(selection.workspaceIds)) {
    const normalizedWorkspaceId = toPositiveInteger(entry);
    if (normalizedWorkspaceId > 0) {
      rooms.add(roomForWorkspace(normalizedWorkspaceId));
    }
  }

  const workspaceUser = selection.workspaceUser;
  if (workspaceUser && typeof workspaceUser === "object") {
    const targetWorkspaceId = toPositiveInteger(workspaceUser.workspaceId);
    const targetUserId = toPositiveInteger(workspaceUser.userId);
    if (targetWorkspaceId > 0 && targetUserId > 0) {
      rooms.add(roomForWorkspaceUser(targetWorkspaceId, targetUserId));
    }
  }

  for (const entry of normalizeArray(selection.workspaceUsers)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const targetWorkspaceId = toPositiveInteger(entry.workspaceId);
    const targetUserId = toPositiveInteger(entry.userId);
    if (targetWorkspaceId > 0 && targetUserId > 0) {
      rooms.add(roomForWorkspaceUser(targetWorkspaceId, targetUserId));
    }
  }
}

function collectUserIdsFromQueryRows(rows = []) {
  const result = new Set();
  for (const row of normalizeArray(rows)) {
    if (typeof row === "number") {
      const directId = toPositiveInteger(row);
      if (directId > 0) {
        result.add(directId);
      }
      continue;
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const userId = toPositiveInteger(row.userId || row.user_id || row.id);
    if (userId > 0) {
      result.add(userId);
    }
  }
  return [...result];
}

async function resolveAudienceQueryRooms(userQuery, { scope, event, logger } = {}) {
  if (typeof userQuery !== "function") {
    return [];
  }

  if (!scope || typeof scope.has !== "function" || typeof scope.make !== "function" || !scope.has(KERNEL_TOKENS.Knex)) {
    logger.warn("Realtime audience userQuery requires runtime database token.");
    return [];
  }

  const knex = scope.make(KERNEL_TOKENS.Knex);
  const queryResult = await userQuery({
    knex,
    event
  });
  const userIds = collectUserIdsFromQueryRows(await Promise.resolve(queryResult));
  return userIds.map((userId) => roomForUser(userId));
}

async function resolveAudienceTargets(dispatcher, event, { scope, logger } = {}) {
  const rooms = new Set();
  const flags = {
    broadcastAllClients: false
  };

  let selection = dispatcher?.audience;
  if (typeof selection === "function") {
    selection = await selection({
      event
    });
  }

  for (const entry of normalizeArray(selection)) {
    if (typeof entry === "string") {
      applyAudiencePreset(entry, {
        event,
        rooms,
        flags,
        logger
      });
      continue;
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    addAudienceRoomsFromObject(entry, {
      event,
      rooms,
      flags,
      logger
    });

    if (typeof entry.userQuery === "function") {
      const queryRooms = await resolveAudienceQueryRooms(entry.userQuery, {
        scope,
        event,
        logger
      });
      for (const room of queryRooms) {
        rooms.add(room);
      }
    }
  }

  return Object.freeze({
    broadcastAllClients: flags.broadcastAllClients,
    rooms: Object.freeze([...rooms])
  });
}

async function resolveSocketActorId(authService, socket) {
  if (!authService || typeof authService.authenticateRequest !== "function") {
    return 0;
  }

  const cookies = parseCookieHeader(socket?.request?.headers?.cookie);
  const authResult = await authService.authenticateRequest({
    cookies
  });
  if (!authResult || authResult.authenticated !== true) {
    return 0;
  }
  return toPositiveInteger(authResult?.profile?.id);
}

async function resolveActorWorkspaceIds(workspaceMembershipsRepository, actorId) {
  if (!workspaceMembershipsRepository || typeof workspaceMembershipsRepository.listActiveWorkspaceIdsByUserId !== "function") {
    return [];
  }

  const workspaceIds = await workspaceMembershipsRepository.listActiveWorkspaceIdsByUserId(actorId);
  return normalizeArray(workspaceIds)
    .map((entry) => toPositiveInteger(entry))
    .filter((entry) => entry > 0);
}

function registerRealtimeSocketAudienceBootstrap(scope, io, logger) {
  if (!io || typeof io.on !== "function") {
    return;
  }

  const authService =
    scope && typeof scope.has === "function" && scope.has("authService") ? scope.make("authService") : null;
  const workspaceMembershipsRepository =
    scope && typeof scope.has === "function" && scope.has("workspaceMembershipsRepository")
      ? scope.make("workspaceMembershipsRepository")
      : null;

  io.on("connection", async (socket) => {
    try {
      socket.join(REALTIME_ROOM_ALL_CLIENTS);

      const actorId = await resolveSocketActorId(authService, socket);
      if (actorId < 1) {
        return;
      }

      socket.data = socket.data && typeof socket.data === "object" ? socket.data : {};
      socket.data.actorId = actorId;

      socket.join(REALTIME_ROOM_ALL_USERS);
      socket.join(roomForUser(actorId));

      const workspaceIds = await resolveActorWorkspaceIds(workspaceMembershipsRepository, actorId);
      for (const workspaceId of workspaceIds) {
        socket.join(roomForWorkspace(workspaceId));
        socket.join(roomForWorkspaceUser(workspaceId, actorId));
      }
    } catch (error) {
      logger.warn(
        {
          listenerId: REALTIME_DOMAIN_EVENT_BRIDGE_TOKEN,
          error: String(error?.message || error || "unknown error")
        },
        "Realtime socket audience bootstrap failed."
      );
    }
  });
}

class RealtimeServiceProvider {
  static id = REALTIME_RUNTIME_SERVER_TOKEN;

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
      throw new Error("RealtimeServiceProvider requires application singleton()/tag().");
    }

    app.singleton(REALTIME_RUNTIME_SERVER_TOKEN, () => REALTIME_RUNTIME_SERVER_API);
    app.singleton(REALTIME_SOCKET_IO_SERVER_TOKEN, (scope) => {
      const fastify = scope.make(KERNEL_TOKENS.Fastify);
      return createSocketIoServer({
        fastify
      });
    });

    registerDomainEventListener(app, REALTIME_DOMAIN_EVENT_BRIDGE_TOKEN, (scope) => {
      const io = scope.make(REALTIME_SOCKET_IO_SERVER_TOKEN);
      const realtimeDispatchIndex = buildRealtimeDispatchIndex(resolveServiceRegistrations(scope));
      const logger = createProviderLogger(scope);

      return {
        listenerId: REALTIME_DOMAIN_EVENT_BRIDGE_TOKEN,
        async handle(event = {}) {
          const serviceToken = normalizeText(event?.meta?.service?.token);
          const methodName = normalizeText(event?.meta?.service?.method);
          if (!serviceToken || !methodName) {
            logger.warn(
              {
                listenerId: REALTIME_DOMAIN_EVENT_BRIDGE_TOKEN,
                reason: "missing-service-meta",
                meta: event?.meta || null
              },
              "Realtime bridge skipped domain event."
            );
            return;
          }

          const dispatchers = realtimeDispatchIndex.get(`${serviceToken}:${methodName}`) || [];
          logger.info(
            {
              listenerId: REALTIME_DOMAIN_EVENT_BRIDGE_TOKEN,
              serviceToken,
              methodName,
              dispatcherCount: dispatchers.length,
              eventType: event?.type || null,
              scope: event?.scope || null,
              entityId: event?.entityId || null
            },
            "Realtime bridge received service event."
          );

          for (const dispatcher of dispatchers) {
            const payload = dispatcher.payload
              ? dispatcher.payload({
                  event
                })
              : event;
            const targets = await resolveAudienceTargets(dispatcher, event, {
              scope,
              logger
            });

            if (targets.broadcastAllClients === true) {
              io.emit(dispatcher.event, payload);
            }
            for (const room of targets.rooms) {
              io.to(room).emit(dispatcher.event, payload);
            }

            logger.info(
              {
                listenerId: REALTIME_DOMAIN_EVENT_BRIDGE_TOKEN,
                socketEvent: dispatcher.event,
                serviceToken,
                methodName,
                rooms: targets.rooms,
                broadcastAllClients: targets.broadcastAllClients,
                connectedClients:
                  io && io.engine && Number.isInteger(Number(io.engine.clientsCount))
                    ? Number(io.engine.clientsCount)
                    : null,
                payloadScope: payload?.scope || null,
                payloadEntityId: payload?.entityId || null
              },
              "Realtime bridge emitted socket event."
            );
          }
        }
      };
    });
  }

  async boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("RealtimeServiceProvider requires application make().");
    }

    this.socketIoServer = app.make(REALTIME_SOCKET_IO_SERVER_TOKEN);
    const logger = createProviderLogger(app);
    registerRealtimeSocketAudienceBootstrap(app, this.socketIoServer, logger);

    const env = typeof app.has === "function" && app.has(KERNEL_TOKENS.Env) ? app.make(KERNEL_TOKENS.Env) : {};
    const redisUrl = resolveRealtimeRedisUrl(env);
    this.redisConnection = await configureSocketIoRedisAdapter(this.socketIoServer, {
      redisUrl
    });
  }

  async shutdown() {
    if (!this.socketIoServer) {
      return;
    }
    await closeSocketIoServer(this.socketIoServer);
    await closeSocketIoRedisConnections(this.redisConnection || {});
    this.redisConnection = null;
    this.socketIoServer = null;
  }
}

export {
  RealtimeServiceProvider
};
