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

// The single mapping from a kernel event scope ({ kind: "user" | "workspace" |
// "workspace_user" }) to its Socket.IO room; null when the scope names no room.
function roomForScope(scope = {}) {
  const kind = normalizeText(scope?.kind).toLowerCase();
  const workspaceId = resolveScopeWorkspaceId(scope);
  const userId = resolveScopeUserId(scope);
  if (kind === "workspace" && workspaceId) return roomForWorkspace(workspaceId);
  if (kind === "workspace_user" && workspaceId && userId) return roomForWorkspaceUser(workspaceId, userId);
  if (kind === "user" && userId) return roomForUser(userId);
  return null;
}

// Packages that know which scopes an actor belongs to (for example workspace
// memberships) contribute them here; realtime only turns scopes into rooms.
function createAudienceContributors() {
  const contributors = new Map();
  return Object.freeze({
    register({ id, resolveActorScopes } = {}) {
      const contributorId = normalizeText(id);
      if (!contributorId) throw new TypeError("Realtime audience contributors require an id.");
      if (typeof resolveActorScopes !== "function") {
        throw new TypeError(`Realtime audience contributor "${contributorId}" requires resolveActorScopes().`);
      }
      if (contributors.has(contributorId)) {
        throw new Error(`Realtime audience contributor "${contributorId}" is already registered.`);
      }
      contributors.set(contributorId, resolveActorScopes);
    },
    // Whether revalidation could make a socket join this room: every room
    // roomForScope() names starts with user: or workspace:.
    mayContribute(room) {
      return contributors.size > 0 && /^(?:user|workspace):/u.test(String(room));
    },
    async resolveActorRooms(actorId) {
      const rooms = new Set();
      for (const resolveActorScopes of contributors.values()) {
        for (const scope of normalizeArray(await resolveActorScopes(actorId))) {
          const room = roomForScope(scope);
          if (room) rooms.add(room);
        }
      }
      return rooms;
    }
  });
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
    // An event without a deliverable scope reaches nobody; broadcasting needs all_users.
    const room = roomForScope(event?.scope);
    if (room) rooms.add(room);
    else logger.warn({ audience: normalized, scope: event?.scope || null }, "Realtime event_scope audience has no deliverable scope.");
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

function createSocketRequest(socket) {
  const handshakeHeaders = socket?.handshake?.headers || {};
  const requestHeaders = socket?.request?.headers || {};
  const host = normalizeText(handshakeHeaders.host || requestHeaders.host);
  const remoteAddress = normalizeText(
    socket?.request?.socket?.remoteAddress || socket?.conn?.remoteAddress || socket?.handshake?.address
  );
  const request = {
    cookies: parseCookieHeader(handshakeHeaders.cookie || requestHeaders.cookie)
  };
  const headers = host ? { host } : {};
  for (const name of ["origin", "x-forwarded-proto"]) {
    const value = handshakeHeaders[name] ?? requestHeaders[name];
    if (value !== undefined) headers[name] = value;
  }
  if (Object.keys(headers).length > 0) request.headers = headers;
  request.socket = { encrypted: socket?.request?.socket?.encrypted === true };
  if (remoteAddress) request.socket.remoteAddress = remoteAddress;
  return request;
}

// A socket cannot store a refreshed session, so its checks never refresh one.
// A provider that would have to (its access token expired) answers
// `refreshRequired`, and the client refreshes over HTTP before reconnecting.
async function resolveSocketAuthentication(authService, socket, request = createSocketRequest(socket),
  authenticateRequest = (value) => authService.authenticateRequest(value, { refreshSession: false })) {
  if (typeof authService?.authenticateRequest !== "function") return { actor: null, refreshRequired: false };
  const result = await authenticateRequest(request);
  const id = result?.authenticated === true
    ? normalizeRecordId(result?.actor?.id, { fallback: null }) : null;
  return { actor: id ? { ...result.actor, id } : null, refreshRequired: result?.refreshRequired === true };
}

function realtimeAuthenticationRequired(authService = null) {
  return authService?.realtime?.requireAuthentication === true;
}

function authenticationRequiredError() {
  const error = new Error("Authentication required.");
  error.data = Object.freeze({ code: "AUTHENTICATION_REQUIRED" });
  return error;
}

function sessionRefreshRequiredError() {
  const error = new Error("Session refresh required.");
  error.data = Object.freeze({ code: "SESSION_REFRESH_REQUIRED" });
  return error;
}

function rememberSocketActorId(socket, actorId) {
  socket.data = socket.data && typeof socket.data === "object" ? socket.data : {};
  socket.data.actorId = actorId;
}

// Every handshake is authenticated here. A login that needs a session refresh
// is refused even when sign-in is optional, so the client refreshes and
// reconnects instead of silently connecting without its user's rooms.
function registerSocketAuthentication({ io, logger, authService }) {
  const required = realtimeAuthenticationRequired(authService);
  if (!required && typeof authService?.authenticateRequest !== "function") return;
  if (typeof io?.use !== "function") {
    throw new TypeError("Realtime socket authentication requires Socket.IO middleware support.");
  }
  io.use(async (socket, next) => {
    try {
      const { actor, refreshRequired } = await resolveSocketAuthentication(authService, socket);
      if (refreshRequired) {
        next(sessionRefreshRequiredError());
        return;
      }
      if (!actor && required) {
        next(authenticationRequiredError());
        return;
      }
      if (actor) rememberSocketActorId(socket, actor.id);
      next();
    } catch (error) {
      logger.warn({ error: String(error?.message || error) }, "Realtime socket authentication failed.");
      next(required ? authenticationRequiredError() : undefined);
    }
  });
}

async function joinContributedRooms(socket, actorId, audiences) {
  const rooms = audiences ? await audiences.resolveActorRooms(actorId) : new Set();
  for (const room of normalizeArray(socket.data?.contributedRooms)) {
    if (!rooms.has(room)) await socket.leave(room);
  }
  for (const room of rooms) await socket.join(room);
  socket.data.contributedRooms = [...rooms];
}

function registerSocketAudienceBootstrap({ io, logger, authService = null, audiences = null }) {
  if (typeof io?.on !== "function") return;
  registerSocketAuthentication({ io, logger, authService });
  io.on("connection", async (socket) => {
    try {
      socket.join(ALL_CLIENTS_ROOM);
      const actorId = normalizeRecordId(socket?.data?.actorId, { fallback: null });
      if (!actorId) return;
      socket.join(ALL_USERS_ROOM);
      socket.join(roomForUser(actorId));
      await joinContributedRooms(socket, actorId, audiences);
    } catch (error) {
      logger.warn({ error: String(error?.message || error) }, "Realtime socket audience bootstrap failed.");
    }
  });
}

async function revalidateSocket({ socket, authService, audiences = null, request, authenticateRequest }) {
  const { actor, refreshRequired } = await resolveSocketAuthentication(authService, socket, request, authenticateRequest);
  const previousActorId = socket.data?.actorId;
  if (refreshRequired || (!actor && realtimeAuthenticationRequired(authService)) ||
      (previousActorId && previousActorId !== actor?.id)) {
    socket.disconnect(true);
    return null;
  }
  if (!actor) return null;

  rememberSocketActorId(socket, actor.id);
  await joinContributedRooms(socket, actor.id, audiences);
  return actor;
}

export {
  createAudienceContributors,
  createSocketRequest,
  realtimeAuthenticationRequired,
  revalidateSocket,
  registerSocketAudienceBootstrap,
  resolveAudienceTargets
};
