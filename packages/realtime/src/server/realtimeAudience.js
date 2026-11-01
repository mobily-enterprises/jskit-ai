import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/auth-core/server/types").AuthService} AuthService */
/** @typedef {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} RuntimeDatabase */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").ActorRoomsResolver} ActorRoomsResolver */
/** @typedef {import("./types.js").AudienceContributors} AudienceContributors */

const ALL_CLIENTS_ROOM = "clients";
const ALL_USERS_ROOM = "users";

/**
 * The value's entries as one flat list without null or undefined: nested
 * arrays are flattened and a single value becomes a one-entry list.
 * @param {unknown} value
 */
function flattenEntries(value) {
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

/** @param {object | null | undefined} scope An event's scope; null or absent names none. */
function resolveScopeWorkspaceId(scope) {
  const kind = normalizeText(scope?.kind).toLowerCase();
  if (kind === "workspace") return normalizeRecordId(scope.id, { fallback: null });
  if (kind === "workspace_user") {
    return normalizeRecordId(scope.workspaceId || scope.id, { fallback: null });
  }
  return normalizeRecordId(scope?.workspaceId, { fallback: null });
}

/** @param {object | null | undefined} scope An event's scope; null or absent names none. */
function resolveScopeUserId(scope) {
  const kind = normalizeText(scope?.kind).toLowerCase();
  if (kind === "user") return normalizeRecordId(scope.id, { fallback: null });
  return normalizeRecordId(scope?.userId, { fallback: null });
}

/**
 * The single mapping from a kernel event scope ({ kind: "user" | "workspace" |
 * "workspace_user" }) to its Socket.IO room; null when the scope names no room.
 * @param {object | null | undefined} scope
 */
function roomForScope(scope) {
  const kind = normalizeText(scope?.kind).toLowerCase();
  const workspaceId = resolveScopeWorkspaceId(scope);
  const userId = resolveScopeUserId(scope);
  if (kind === "workspace" && workspaceId) return roomForWorkspace(workspaceId);
  if (kind === "workspace_user" && workspaceId && userId) return roomForWorkspaceUser(workspaceId, userId);
  if (kind === "user" && userId) return roomForUser(userId);
  return null;
}

/**
 * Packages that know which scopes an actor belongs to (for example workspace
 * memberships) contribute them here; realtime only turns scopes into rooms.
 */
function createAudienceContributors() {
  const contributors = new Map();

  /** @param {import("./types.js").RealtimeAudienceContributor} contributor Validated here. */
  function register({ id, resolveActorScopes }) {
    const contributorId = normalizeText(id);
    if (!contributorId) throw new TypeError("Realtime audience contributors require an id.");
    // readable-check: allow method-probe - input validation: a package registers its own contributor
    if (typeof resolveActorScopes !== "function") {
      throw new TypeError(`Realtime audience contributor "${contributorId}" requires resolveActorScopes().`);
    }
    if (contributors.has(contributorId)) {
      throw new Error(`Realtime audience contributor "${contributorId}" is already registered.`);
    }
    contributors.set(contributorId, resolveActorScopes);
  }

  /**
   * Whether revalidation could make a socket join this room: every room
   * roomForScope() names starts with user: or workspace:.
   * @param {string} room
   */
  function mayContribute(room) {
    return contributors.size > 0 && /^(?:user|workspace):/u.test(String(room));
  }

  /** @type {ActorRoomsResolver} */
  async function resolveActorRooms(actorId) {
    const rooms = new Set();
    for (const resolveActorScopes of contributors.values()) {
      for (const scope of flattenEntries(await resolveActorScopes(actorId))) {
        const room = roomForScope(scope);
        if (room) rooms.add(room);
      }
    }
    return rooms;
  }

  return Object.freeze({ register, mayContribute, resolveActorRooms });
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
  const { rooms, flags } = state;
  if (Object.hasOwn(selection, "preset")) {
    applyAudiencePreset(selection.preset, state);
  }
  if (selection.broadcast === true) flags.broadcastAllClients = true;

  const directRoom = normalizeText(selection.room);
  if (directRoom) rooms.add(directRoom);
  for (const entry of flattenEntries(selection.rooms)) {
    const room = normalizeText(entry);
    if (room) rooms.add(room);
  }

  const directUserId = normalizeRecordId(selection.userId, { fallback: null });
  if (directUserId) rooms.add(roomForUser(directUserId));
  for (const entry of flattenEntries(selection.userIds)) {
    const userId = normalizeRecordId(entry, { fallback: null });
    if (userId) rooms.add(roomForUser(userId));
  }

  const directWorkspaceId = normalizeRecordId(selection.workspaceId, { fallback: null });
  if (directWorkspaceId) rooms.add(roomForWorkspace(directWorkspaceId));
  for (const entry of flattenEntries(selection.workspaceIds)) {
    const workspaceId = normalizeRecordId(entry, { fallback: null });
    if (workspaceId) rooms.add(roomForWorkspace(workspaceId));
  }

  for (const entry of flattenEntries([selection.workspaceUser, selection.workspaceUsers])) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const workspaceId = normalizeRecordId(entry.workspaceId, { fallback: null });
    const userId = normalizeRecordId(entry.userId, { fallback: null });
    if (workspaceId && userId) rooms.add(roomForWorkspaceUser(workspaceId, userId));
  }
}

function collectUserIds(rows) {
  const ids = new Set();
  for (const row of flattenEntries(rows)) {
    const rawId = typeof row === "number" ? row : row?.userId || row?.user_id || row?.id;
    const id = normalizeRecordId(rawId, { fallback: null });
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * @param {unknown} audience
 * @param {object} event
 * @param {object} dependencies
 * @param {RuntimeDatabase | null} dependencies.database Absent when no runtime.database is installed.
 * @param {RuntimeLogger} dependencies.logger
 */
async function resolveAudienceTargets(audience, event, { database, logger }) {
  const rooms = new Set();
  const flags = { broadcastAllClients: false };
  const state = { event, rooms, flags, logger };

  for (const entry of flattenEntries(audience)) {
    if (typeof entry === "string") {
      applyAudiencePreset(entry, state);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    addAudienceRooms(entry, state);
    // readable-check: allow method-probe - data: an event's audience entry may name a userQuery()
    if (typeof entry.userQuery === "function") {
      if (!database) {
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

/**
 * The request a socket's handshake stands for, as the auth service reads one.
 * @param {import("socket.io").Socket} socket
 */
function createSocketRequest(socket) {
  const handshakeHeaders = socket.handshake.headers;
  const requestHeaders = socket.request.headers;
  const host = normalizeText(handshakeHeaders.host || requestHeaders.host);
  const remoteAddress = normalizeText(
    socket.request.socket.remoteAddress || socket.conn.remoteAddress || socket.handshake.address
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
  request.socket = { encrypted: socket.request.socket.encrypted === true };
  if (remoteAddress) request.socket.remoteAddress = remoteAddress;
  return request;
}

/**
 * The auth service's check of a socket request: who is signed in, without
 * refreshing a session the socket could not store.
 * @param {AuthService} authService
 * @returns {(request: object) => ReturnType<AuthService["authenticateRequest"]>}
 */
function authenticateWithoutRefresh(authService) {
  return (request) => authService.authenticateRequest(request, { refreshSession: false });
}

/**
 * A socket cannot store a refreshed session, so its checks never refresh one.
 * A provider that would have to (its access token expired) answers
 * `refreshRequired`, and the client refreshes over HTTP before reconnecting.
 * @param {AuthService | null} authService Absent when no auth.service is installed.
 * @param {import("socket.io").Socket} socket
 * @param {object} [request]
 * @param {(request: object) => ReturnType<AuthService["authenticateRequest"]>} [authenticateRequest]
 */
async function resolveSocketAuthentication(authService, socket, request = createSocketRequest(socket),
  authenticateRequest = authenticateWithoutRefresh(authService)) {
  if (!authService) return { actor: null, refreshRequired: false };
  const result = await authenticateRequest(request);
  const id = result.authenticated === true
    ? normalizeRecordId(result.actor.id, { fallback: null }) : null;
  return { actor: id ? { ...result.actor, id } : null, refreshRequired: result.refreshRequired === true };
}

/** @param {AuthService | null} authService Absent when no auth.service is installed. */
function realtimeAuthenticationRequired(authService) {
  return authService?.realtime?.requireAuthentication === true;
}

/**
 * The kernel's code for this English, so a client can show it in the user's
 * language: as the error's code for a host's action boundary, and in its data
 * for a refused Socket.IO handshake.
 */
function authenticationRequiredError() {
  return Object.assign(new Error("Authentication required."), {
    statusCode: 401,
    code: "AUTHENTICATION_REQUIRED",
    data: Object.freeze({ code: "AUTHENTICATION_REQUIRED" })
  });
}

function sessionRefreshRequiredError() {
  const error = new Error("Session refresh required.");
  error.data = Object.freeze({ code: "SESSION_REFRESH_REQUIRED" });
  return error;
}

function rememberSocketActorId(socket, actorId) {
  socket.data.actorId = actorId;
}

/**
 * Every handshake is authenticated here. A login that needs a session refresh
 * is refused even when sign-in is optional, so the client refreshes and
 * reconnects instead of silently connecting without its user's rooms.
 * @param {object} dependencies
 * @param {import("socket.io").Server} dependencies.io
 * @param {RuntimeLogger} dependencies.logger
 * @param {AuthService | null} dependencies.authService Absent when no auth.service is installed.
 */
function registerSocketAuthentication({ io, logger, authService }) {
  if (!authService) return;
  const required = realtimeAuthenticationRequired(authService);
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

/**
 * @param {import("socket.io").Socket} socket
 * @param {string} actorId
 * @param {{ resolveActorRooms: ActorRoomsResolver }} audiences
 */
async function joinContributedRooms(socket, actorId, audiences) {
  const rooms = await audiences.resolveActorRooms(actorId);
  for (const room of flattenEntries(socket.data.contributedRooms)) {
    if (!rooms.has(room)) await socket.leave(room);
  }
  for (const room of rooms) await socket.join(room);
  socket.data.contributedRooms = [...rooms];
}

/**
 * @param {object} dependencies
 * @param {import("socket.io").Server} dependencies.io
 * @param {RuntimeLogger} dependencies.logger
 * @param {AuthService | null} dependencies.authService Absent when no auth.service is installed.
 * @param {AudienceContributors} dependencies.audiences
 */
function registerSocketAudienceBootstrap({ io, logger, authService, audiences }) {
  registerSocketAuthentication({ io, logger, authService });
  io.on("connection", async (socket) => {
    try {
      socket.join(ALL_CLIENTS_ROOM);
      const actorId = normalizeRecordId(socket.data.actorId, { fallback: null });
      if (!actorId) return;
      socket.join(ALL_USERS_ROOM);
      socket.join(roomForUser(actorId));
      await joinContributedRooms(socket, actorId, audiences);
    } catch (error) {
      logger.warn({ error: String(error?.message || error) }, "Realtime socket audience bootstrap failed.");
    }
  });
}

/**
 * @param {object} options
 * @param {import("socket.io").Socket} options.socket
 * @param {AuthService | null} options.authService Absent when no auth.service is installed.
 * @param {{ resolveActorRooms: ActorRoomsResolver }} options.audiences
 * @param {object} [options.request]
 * @param {Parameters<typeof resolveSocketAuthentication>[3]} [options.authenticateRequest]
 */
async function revalidateSocket({ socket, authService, audiences, request, authenticateRequest }) {
  const { actor, refreshRequired } = await resolveSocketAuthentication(authService, socket, request, authenticateRequest);
  const previousActorId = socket.data.actorId;
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
  authenticationRequiredError,
  createAudienceContributors,
  createSocketRequest,
  realtimeAuthenticationRequired,
  revalidateSocket,
  registerSocketAudienceBootstrap,
  resolveAudienceTargets
};
