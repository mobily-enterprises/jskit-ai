import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const ALL_CLIENTS_ROOM = "clients";
const ALL_USERS_ROOM = "users";

function normalizeArray(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const list = [];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (Array.isArray(entry)) queue.push(...entry);
    else if (entry != null) list.push(entry);
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

function resolveScopeWorkspaceId(scope = {}) {
  const kind = normalizeText(scope?.kind).toLowerCase();
  if (kind === "workspace") return normalizeRecordId(scope.id, { fallback: null });
  if (kind === "workspace_user") {
    return normalizeRecordId(scope.workspaceId || scope.id, { fallback: null });
  }
  return normalizeRecordId(scope?.workspaceId, { fallback: null });
}

function resolveScopeUserId(scope = {}) {
  const kind = normalizeText(scope?.kind).toLowerCase();
  if (kind === "user") return normalizeRecordId(scope.id, { fallback: null });
  return normalizeRecordId(scope?.userId, { fallback: null });
}

function applyAudiencePreset(preset, { event, rooms, flags, logger }) {
  const normalized = normalizeText(preset).toLowerCase();
  if (!normalized || normalized === "none") return;
  if (normalized === "all_clients") {
    flags.broadcastAllClients = true;
    return;
  }
  if (normalized === "all_users") {
    rooms.add(ALL_USERS_ROOM);
    return;
  }
  if (normalized === "actor_user") {
    const actorId = normalizeRecordId(event?.actorId, { fallback: null });
    if (actorId) rooms.add(roomForUser(actorId));
    return;
  }
  if (normalized === "all_workspace_users") {
    const workspaceId = resolveScopeWorkspaceId(event?.scope);
    if (workspaceId) rooms.add(roomForWorkspace(workspaceId));
    else logger.warn({ audience: normalized, scope: event?.scope || null }, "Realtime audience requires a workspace scope.");
    return;
  }
  if (normalized === "event_scope") {
    const scopeKind = normalizeText(event?.scope?.kind).toLowerCase();
    const workspaceId = resolveScopeWorkspaceId(event?.scope);
    const userId = resolveScopeUserId(event?.scope);
    if (scopeKind === "workspace" && workspaceId) rooms.add(roomForWorkspace(workspaceId));
    else if (scopeKind === "workspace_user" && workspaceId && userId) {
      rooms.add(roomForWorkspaceUser(workspaceId, userId));
    } else if (scopeKind === "user" && userId) rooms.add(roomForUser(userId));
    else rooms.add(ALL_USERS_ROOM);
    return;
  }
  logger.warn({ audience: normalized }, "Realtime ignored an unknown audience preset.");
}

function addAudienceRooms(selection, state) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return;
  const { event, rooms, flags, logger } = state;
  if (Object.hasOwn(selection, "preset")) {
    applyAudiencePreset(selection.preset, state);
  }
  if (selection.broadcast === true) flags.broadcastAllClients = true;

  const directRoom = normalizeText(selection.room);
  if (directRoom) rooms.add(directRoom);
  for (const entry of normalizeArray(selection.rooms)) {
    const room = normalizeText(entry);
    if (room) rooms.add(room);
  }

  const directUserId = normalizeRecordId(selection.userId, { fallback: null });
  if (directUserId) rooms.add(roomForUser(directUserId));
  for (const entry of normalizeArray(selection.userIds)) {
    const userId = normalizeRecordId(entry, { fallback: null });
    if (userId) rooms.add(roomForUser(userId));
  }

  const directWorkspaceId = normalizeRecordId(selection.workspaceId, { fallback: null });
  if (directWorkspaceId) rooms.add(roomForWorkspace(directWorkspaceId));
  for (const entry of normalizeArray(selection.workspaceIds)) {
    const workspaceId = normalizeRecordId(entry, { fallback: null });
    if (workspaceId) rooms.add(roomForWorkspace(workspaceId));
  }

  for (const entry of normalizeArray([selection.workspaceUser, selection.workspaceUsers])) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const workspaceId = normalizeRecordId(entry.workspaceId, { fallback: null });
    const userId = normalizeRecordId(entry.userId, { fallback: null });
    if (workspaceId && userId) rooms.add(roomForWorkspaceUser(workspaceId, userId));
  }

  if (!event || !logger) throw new TypeError("Realtime audience state is incomplete.");
}

function collectUserIds(rows) {
  const ids = new Set();
  for (const row of normalizeArray(rows)) {
    const rawId = typeof row === "number" ? row : row?.userId || row?.user_id || row?.id;
    const id = normalizeRecordId(rawId, { fallback: null });
    if (id) ids.add(id);
  }
  return [...ids];
}

async function resolveAudienceTargets(audience, event, { database = null, logger }) {
  const rooms = new Set();
  const flags = { broadcastAllClients: false };
  const state = { event, rooms, flags, logger };

  for (const entry of normalizeArray(audience)) {
    if (typeof entry === "string") {
      applyAudiencePreset(entry, state);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    addAudienceRooms(entry, state);
    if (typeof entry.userQuery === "function") {
      if (typeof database?.knex !== "function") {
        logger.warn("Realtime audience userQuery requires runtime.database.");
        continue;
      }
      const rows = await entry.userQuery({ knex: database.knex, event });
      for (const userId of collectUserIds(rows)) rooms.add(roomForUser(userId));
    }
  }

  return Object.freeze({
    broadcastAllClients: flags.broadcastAllClients,
    rooms: Object.freeze([...rooms])
  });
}

function parseCookieHeader(value = "") {
  const cookies = {};
  for (const entry of String(value || "").split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1) continue;
    const key = entry.slice(0, separator).trim();
    if (!key) continue;
    const rawValue = entry.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

async function resolveSocketActorId(authService, socket) {
  if (typeof authService?.authenticateRequest !== "function") return null;
  const handshakeHeaders = socket?.handshake?.headers || {};
  const requestHeaders = socket?.request?.headers || {};
  const host = normalizeText(handshakeHeaders.host || requestHeaders.host);
  const remoteAddress = normalizeText(
    socket?.request?.socket?.remoteAddress || socket?.conn?.remoteAddress || socket?.handshake?.address
  );
  const request = {
    cookies: parseCookieHeader(handshakeHeaders.cookie || requestHeaders.cookie)
  };
  if (host) request.headers = { host };
  if (remoteAddress) request.socket = { remoteAddress };
  const result = await authService.authenticateRequest(request);
  return result?.authenticated === true
    ? normalizeRecordId(result?.actor?.id, { fallback: null })
    : null;
}

function realtimeAuthenticationRequired(authService = null) {
  return authService?.realtime?.requireAuthentication === true;
}

function authenticationRequiredError() {
  const error = new Error("Authentication required.");
  error.data = Object.freeze({ code: "AUTHENTICATION_REQUIRED" });
  return error;
}

function rememberSocketActorId(socket, actorId) {
  socket.data = socket.data && typeof socket.data === "object" ? socket.data : {};
  socket.data.actorId = actorId;
}

function registerRequiredSocketAuthentication({ io, logger, authService }) {
  if (!realtimeAuthenticationRequired(authService)) return;
  if (typeof io?.use !== "function") {
    throw new TypeError("Realtime authenticated-client mode requires Socket.IO middleware support.");
  }
  io.use(async (socket, next) => {
    try {
      const actorId = await resolveSocketActorId(authService, socket);
      if (!actorId) {
        next(authenticationRequiredError());
        return;
      }
      rememberSocketActorId(socket, actorId);
      next();
    } catch (error) {
      logger.warn({ error: String(error?.message || error) }, "Realtime socket authentication failed.");
      next(authenticationRequiredError());
    }
  });
}

function registerSocketAudienceBootstrap({ io, logger, authService = null, workspaces = null }) {
  if (typeof io?.on !== "function") return;
  registerRequiredSocketAuthentication({ io, logger, authService });
  io.on("connection", async (socket) => {
    try {
      socket.join(ALL_CLIENTS_ROOM);
      const actorId = normalizeRecordId(socket?.data?.actorId, { fallback: null })
        || await resolveSocketActorId(authService, socket);
      if (!actorId) return;
      rememberSocketActorId(socket, actorId);
      socket.join(ALL_USERS_ROOM);
      socket.join(roomForUser(actorId));
      const repository = workspaces?.repositories?.workspaceMemberships;
      const workspaceIds = typeof repository?.listActiveWorkspaceIdsByUserId === "function"
        ? await repository.listActiveWorkspaceIdsByUserId(actorId)
        : [];
      for (const rawId of normalizeArray(workspaceIds)) {
        const workspaceId = normalizeRecordId(rawId, { fallback: null });
        if (!workspaceId) continue;
        socket.join(roomForWorkspace(workspaceId));
        socket.join(roomForWorkspaceUser(workspaceId, actorId));
      }
    } catch (error) {
      logger.warn({ error: String(error?.message || error) }, "Realtime socket audience bootstrap failed.");
    }
  });
}

export {
  realtimeAuthenticationRequired,
  registerSocketAudienceBootstrap,
  resolveAudienceTargets
};
