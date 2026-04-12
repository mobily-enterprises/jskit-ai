import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createProviderLogger as createSharedProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import {
  registerDomainEventListener,
  resolveServiceRegistrations
} from "@jskit-ai/kernel/server/runtime";
import {
  createSocketIoServer,
  closeSocketIoServer,
  resolveRealtimeRedisUrl,
  resolveRealtimeRedisNamespace,
  configureSocketIoRedisAdapter,
  closeSocketIoRedisConnections
} from "./runtime.js";

const REALTIME_RUNTIME_SERVER_API = Object.freeze({
  createSocketIoServer,
  closeSocketIoServer
});

const REALTIME_ROOM_ALL_CLIENTS = "clients";
const REALTIME_ROOM_ALL_USERS = "users";

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
  return `user:${String(userId || "").trim()}`;
}

function roomForWorkspace(workspaceId) {
  return `workspace:${String(workspaceId || "").trim()}`;
}

function roomForWorkspaceUser(workspaceId, userId) {
  return `workspace:${String(workspaceId || "").trim()}:user:${String(userId || "").trim()}`;
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

function createProviderLogger(scope, { debugEnabled = false } = {}) {
  const logger =
    scope && typeof scope.has === "function" && scope.has("jskit.logger") ? scope.make("jskit.logger") : null;
  return createSharedProviderLogger(logger, { debugEnabled });
}

function parseDebugFlag(value, fallback = null) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return fallback;
}

function resolveRealtimeServerDebugEnabled(scope) {
  const appConfig = scope && typeof scope.has === "function" && scope.has("appConfig") ? scope.make("appConfig") : {};
  const env = scope && typeof scope.has === "function" && scope.has("jskit.env") ? scope.make("jskit.env") : {};
  const realtime = appConfig && typeof appConfig === "object" ? appConfig.realtime : null;

  const envFlag = parseDebugFlag(env?.JSKIT_REALTIME_DEBUG);
  if (envFlag !== null) {
    return envFlag;
  }

  const configFlag = parseDebugFlag(realtime?.debug);
  if (configFlag !== null) {
    return configFlag;
  }

  return false;
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

function mergeRealtimePayload(event, payloadPatch) {
  const basePayload = event && typeof event === "object" && !Array.isArray(event) ? event : {};
  if (payloadPatch == null) {
    return basePayload;
  }
  if (!payloadPatch || typeof payloadPatch !== "object" || Array.isArray(payloadPatch)) {
    throw new TypeError("Realtime payload callback must return an object.");
  }

  // Keep canonical domain-event fields authoritative while allowing additive metadata.
  return {
    ...payloadPatch,
    ...basePayload
  };
}

function resolveScopeWorkspaceId(scope = {}) {
  const source = scope && typeof scope === "object" && !Array.isArray(scope) ? scope : {};
  if (String(source.kind || "").trim().toLowerCase() === "workspace") {
    return normalizeRecordId(source.id, { fallback: null });
  }
  if (String(source.kind || "").trim().toLowerCase() === "workspace_user") {
    return normalizeRecordId(source.workspaceId || source.id, { fallback: null });
  }
  return normalizeRecordId(source.workspaceId, { fallback: null });
}

function resolveScopeUserId(scope = {}) {
  const source = scope && typeof scope === "object" && !Array.isArray(scope) ? scope : {};
  if (String(source.kind || "").trim().toLowerCase() === "user") {
    return normalizeRecordId(source.id, { fallback: null });
  }
  if (String(source.kind || "").trim().toLowerCase() === "workspace_user") {
    return normalizeRecordId(source.userId, { fallback: null });
  }
  return normalizeRecordId(source.userId, { fallback: null });
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
    const actorId = normalizeRecordId(event?.actorId, { fallback: null });
    if (actorId) {
      rooms.add(roomForUser(actorId));
    }
    return;
  }

  if (normalizedPreset === "all_workspace_users") {
    const workspaceId = resolveScopeWorkspaceId(event?.scope);
    if (workspaceId) {
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
      if (workspaceId) {
        rooms.add(roomForWorkspace(workspaceId));
      }
      return;
    }
    if (scopeKind === "workspace_user") {
      const workspaceId = resolveScopeWorkspaceId(event?.scope);
      const userId = resolveScopeUserId(event?.scope);
      if (workspaceId && userId) {
        rooms.add(roomForWorkspaceUser(workspaceId, userId));
      }
      return;
    }
    if (scopeKind === "user") {
      const userId = resolveScopeUserId(event?.scope);
      if (userId) {
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

  const userId = normalizeRecordId(selection.userId, { fallback: null });
  if (userId) {
    rooms.add(roomForUser(userId));
  }
  for (const entry of normalizeArray(selection.userIds)) {
    const normalizedUserId = normalizeRecordId(entry, { fallback: null });
    if (normalizedUserId) {
      rooms.add(roomForUser(normalizedUserId));
    }
  }

  const workspaceId = normalizeRecordId(selection.workspaceId, { fallback: null });
  if (workspaceId) {
    rooms.add(roomForWorkspace(workspaceId));
  }
  for (const entry of normalizeArray(selection.workspaceIds)) {
    const normalizedWorkspaceId = normalizeRecordId(entry, { fallback: null });
    if (normalizedWorkspaceId) {
      rooms.add(roomForWorkspace(normalizedWorkspaceId));
    }
  }

  const workspaceUser = selection.workspaceUser;
  if (workspaceUser && typeof workspaceUser === "object") {
    const targetWorkspaceId = normalizeRecordId(workspaceUser.workspaceId, { fallback: null });
    const targetUserId = normalizeRecordId(workspaceUser.userId, { fallback: null });
    if (targetWorkspaceId && targetUserId) {
      rooms.add(roomForWorkspaceUser(targetWorkspaceId, targetUserId));
    }
  }

  for (const entry of normalizeArray(selection.workspaceUsers)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const targetWorkspaceId = normalizeRecordId(entry.workspaceId, { fallback: null });
    const targetUserId = normalizeRecordId(entry.userId, { fallback: null });
    if (targetWorkspaceId && targetUserId) {
      rooms.add(roomForWorkspaceUser(targetWorkspaceId, targetUserId));
    }
  }
}

function collectUserIdsFromQueryRows(rows = []) {
  const result = new Set();
  for (const row of normalizeArray(rows)) {
    if (typeof row === "number") {
      const directId = normalizeRecordId(row, { fallback: null });
      if (directId) {
        result.add(directId);
      }
      continue;
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const userId = normalizeRecordId(row.userId || row.user_id || row.id, { fallback: null });
    if (userId) {
      result.add(userId);
    }
  }
  return [...result];
}

async function resolveAudienceQueryRooms(userQuery, { scope, event, logger } = {}) {
  if (typeof userQuery !== "function") {
    return [];
  }

  if (!scope || typeof scope.has !== "function" || typeof scope.make !== "function" || !scope.has("jskit.database.knex")) {
    logger.warn("Realtime audience userQuery requires runtime database token.");
    return [];
  }

  const knex = scope.make("jskit.database.knex");
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
    return null;
  }

  const cookies = parseCookieHeader(socket?.request?.headers?.cookie);
  const authResult = await authService.authenticateRequest({
    cookies
  });
  if (!authResult || authResult.authenticated !== true) {
    return null;
  }
  return normalizeRecordId(authResult?.profile?.id, { fallback: null });
}

async function resolveActorWorkspaceIds(workspaceMembershipsRepository, actorId) {
  if (!workspaceMembershipsRepository || typeof workspaceMembershipsRepository.listActiveWorkspaceIdsByUserId !== "function") {
    return [];
  }

  const workspaceIds = await workspaceMembershipsRepository.listActiveWorkspaceIdsByUserId(actorId);
  return normalizeArray(workspaceIds)
    .map((entry) => normalizeRecordId(entry, { fallback: null }))
    .filter(Boolean);
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
      logger.debug(
        {
          listenerId: "runtime.realtime.domain-event-bridge",
          stage: "socket.connection",
          room: REALTIME_ROOM_ALL_CLIENTS
        },
        "Realtime socket joined default clients room."
      );

      const actorId = await resolveSocketActorId(authService, socket);
      if (!actorId) {
        logger.debug(
          {
            listenerId: "runtime.realtime.domain-event-bridge",
            stage: "socket.connection",
            authenticated: false
          },
          "Realtime socket connected without authenticated actor."
        );
        return;
      }

      socket.data = socket.data && typeof socket.data === "object" ? socket.data : {};
      socket.data.actorId = actorId;

      socket.join(REALTIME_ROOM_ALL_USERS);
      socket.join(roomForUser(actorId));
      logger.debug(
        {
          listenerId: "runtime.realtime.domain-event-bridge",
          stage: "socket.connection",
          actorId,
          joinedRooms: [REALTIME_ROOM_ALL_USERS, roomForUser(actorId)]
        },
        "Realtime socket joined actor/user rooms."
      );

      const workspaceIds = await resolveActorWorkspaceIds(workspaceMembershipsRepository, actorId);
      for (const workspaceId of workspaceIds) {
        socket.join(roomForWorkspace(workspaceId));
        socket.join(roomForWorkspaceUser(workspaceId, actorId));
      }
      logger.debug(
        {
          listenerId: "runtime.realtime.domain-event-bridge",
          stage: "socket.connection",
          actorId,
          workspaceIds
        },
        "Realtime socket joined workspace rooms."
      );
    } catch (error) {
      logger.warn(
        {
          listenerId: "runtime.realtime.domain-event-bridge",
          error: String(error?.message || error || "unknown error")
        },
        "Realtime socket audience bootstrap failed."
      );
    }
  });
}

class RealtimeServiceProvider {
  static id = "runtime.realtime";

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
      throw new Error("RealtimeServiceProvider requires application singleton()/tag().");
    }

    app.singleton("runtime.realtime", () => REALTIME_RUNTIME_SERVER_API);
    app.singleton("runtime.realtime.io", (scope) => {
      const fastify = scope.make("jskit.fastify");
      return createSocketIoServer({
        fastify
      });
    });

    registerDomainEventListener(app, "runtime.realtime.domain-event-bridge", (scope) => {
      const io = scope.make("runtime.realtime.io");
      const realtimeDispatchIndex = buildRealtimeDispatchIndex(resolveServiceRegistrations(scope));
      const logger = createProviderLogger(scope, {
        debugEnabled: resolveRealtimeServerDebugEnabled(scope)
      });

      return {
        listenerId: "runtime.realtime.domain-event-bridge",
        async handle(event = {}) {
          const serviceToken = normalizeText(event?.meta?.service?.token);
          const methodName = normalizeText(event?.meta?.service?.method);
          const emittedRealtimeEvent = normalizeText(event?.meta?.realtime?.event);
          if (!serviceToken || !methodName) {
            logger.warn(
              {
                listenerId: "runtime.realtime.domain-event-bridge",
                reason: "missing-service-meta",
                meta: event?.meta || null
              },
              "Realtime bridge skipped domain event."
            );
            return;
          }

          const dispatchersForMethod = realtimeDispatchIndex.get(`${serviceToken}:${methodName}`) || [];
          const dispatchers =
            emittedRealtimeEvent.length > 0
              ? dispatchersForMethod.filter((dispatcher) => normalizeText(dispatcher?.event) === emittedRealtimeEvent)
              : dispatchersForMethod;
          logger.debug(
            {
              listenerId: "runtime.realtime.domain-event-bridge",
              serviceToken,
              methodName,
              emittedRealtimeEvent: emittedRealtimeEvent || null,
              dispatcherCount: dispatchers.length,
              methodDispatcherCount: dispatchersForMethod.length,
              eventType: event?.type || null,
              scope: event?.scope || null,
              entityId: event?.entityId || null
            },
            "Realtime bridge received service event."
          );

          if (dispatchers.length < 1) {
            logger.warn(
              {
                listenerId: "runtime.realtime.domain-event-bridge",
                serviceToken,
                methodName,
                emittedRealtimeEvent: emittedRealtimeEvent || null
              },
              "Realtime bridge found no matching dispatcher for service event."
            );
            return;
          }

          for (const dispatcher of dispatchers) {
            const payloadPatch =
              event?.meta?.realtime && typeof event.meta.realtime === "object"
                ? event.meta.realtime.payload
                : null;
            const payload = mergeRealtimePayload(event, payloadPatch);
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

            logger.debug(
              {
                listenerId: "runtime.realtime.domain-event-bridge",
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

    this.socketIoServer = app.make("runtime.realtime.io");
    const debugEnabled = resolveRealtimeServerDebugEnabled(app);
    const logger = createProviderLogger(app, {
      debugEnabled
    });
    logger.debug(
      {
        providerId: RealtimeServiceProvider.id,
        debugEnabled
      },
      "Realtime server debug mode enabled."
    );
    registerRealtimeSocketAudienceBootstrap(app, this.socketIoServer, logger);

    const env = typeof app.has === "function" && app.has("jskit.env") ? app.make("jskit.env") : {};
    const redisUrl = resolveRealtimeRedisUrl(env);
    const redisNamespace = resolveRealtimeRedisNamespace(env);
    this.redisConnection = await configureSocketIoRedisAdapter(this.socketIoServer, {
      redisUrl,
      redisNamespace
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
