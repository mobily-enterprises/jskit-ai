import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { isRecord, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/auth-core/server/types").AuthService} AuthService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").ActorRoomsResolver} ActorRoomsResolver */
/** @typedef {import("./types.js").ActorsRoomsResolver} ActorsRoomsResolver */
/** @typedef {import("./types.js").AudienceContributors} AudienceContributors */
/** @typedef {import("./types.js").RealtimeAudienceScope} RealtimeAudienceScope */

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
 * A contributor answers for many actors at once, so a publish that may let
 * every online actor into a room asks each contributor once, not once per actor.
 */
function createAudienceContributors() {
  const contributors = new Map();

  /** @param {import("./types.js").RealtimeAudienceContributor} contributor Validated here. */
  function register({ id, resolveActorsScopes }) {
    const contributorId = normalizeText(id);
    if (!contributorId) throw new TypeError("Realtime audience contributors require an id.");
    // readable-check: allow method-probe - input validation: a package registers its own contributor
    if (typeof resolveActorsScopes !== "function") {
      throw new TypeError(`Realtime audience contributor "${contributorId}" requires resolveActorsScopes().`);
    }
    if (contributors.has(contributorId)) {
      throw new Error(`Realtime audience contributor "${contributorId}" is already registered.`);
    }
    contributors.set(contributorId, { id: contributorId, resolveActorsScopes });
  }

  /**
   * Whether revalidation could make a socket join this room: every room
   * roomForScope() names starts with user: or workspace:.
   * @param {string} room
   */
  function mayContribute(room) {
    return contributors.size > 0 && /^(?:user|workspace):/u.test(String(room));
  }

  /**
   * Every actor's contributed rooms, with one call per contributor whatever
   * the number of actors.
   * @type {ActorsRoomsResolver}
   */
  async function resolveActorsRooms(actorIds) {
    const roomsByActorId = new Map();
    for (const actorId of actorIds) roomsByActorId.set(actorId, new Set());
    if (roomsByActorId.size === 0) return roomsByActorId;
    for (const { id, resolveActorsScopes } of contributors.values()) {
      const scopesByActorId = await resolveActorsScopes([...roomsByActorId.keys()]);
      if (!(scopesByActorId instanceof Map)) {
        throw new TypeError(`Realtime audience contributor "${id}" must resolve to a Map of actor ids to scopes.`);
      }
      for (const [actorId, rooms] of roomsByActorId) {
        for (const scope of flattenEntries(scopesByActorId.get(actorId))) {
          const room = roomForScope(scope);
          if (room) rooms.add(room);
        }
      }
    }
    return roomsByActorId;
  }

  /** @type {ActorRoomsResolver} */
  async function resolveActorRooms(actorId) {
    return (await resolveActorsRooms([actorId])).get(actorId);
  }

  return Object.freeze({
    register,
    mayContribute,
    resolveActorRooms,
    resolveActorsRooms
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

/**
 * The options an audience's audienceUsers reads with: a context scoped to the
 * event's own workspace, workspace user or user, so owner APIs answer for the
 * event's scope and never for a request's. The scope is the one the framework
 * built from the write's execution: an event written on a customer's or a public
 * surface carries the workspace the request resolved as its global scope's
 * `workspaceId`. The payload never chooses it: an app's payload may copy an
 * input id. An event whose scope names no workspace and no user, or an
 * application without `realtime.audience-scope`, reads with no context.
 * @param {object} event
 * @param {RealtimeAudienceScope | null | undefined} audienceScope
 */
function audienceReadOptions(event, audienceScope) {
  if (!audienceScope) return Object.freeze({});
  const scope = event?.scope;
  const kind = normalizeText(scope?.kind).toLowerCase();
  const userId = resolveScopeUserId(scope);
  const workspaceId = kind === "user" ? null : resolveScopeWorkspaceId(scope);
  if (workspaceId) {
    return Object.freeze({
      context: userId ? audienceScope.forWorkspaceUser(workspaceId, userId) : audienceScope.forWorkspace(workspaceId)
    });
  }
  if (kind === "user" && userId) {
    return Object.freeze({ context: audienceScope.forUser(userId) });
  }
  return Object.freeze({});
}

/**
 * Whether an audience entry reads its users with audienceUsers in a scope: every one does, unless it says it reads
 * public tables only (`publicTablesOnly: true`), which need no context.
 * @param {unknown} entry
 */
function readsInScope(entry) {
  // readable-check: allow method-probe - data: an event's audience entry may name audienceUsers()
  return isRecord(entry) && typeof entry.audienceUsers === "function" && entry.publicTablesOnly !== true;
}

/**
 * The actions whose events declare an audience that reads its users in the event's scope, which only
 * `realtime.audience-scope` gives: an audience given as a function of the execution is not known before it runs.
 * @param {{ listDefinitions: () => Array<{ id: string, events: readonly Function[] }> } | null} actions
 * @returns {string[]}
 */
function actionsNeedingAudienceScope(actions) {
  const ids = new Set();
  for (const definition of actions?.listDefinitions() ?? []) {
    for (const build of definition.events) {
      const audience = build.realtime?.audience;
      if (typeof audience !== "function" && flattenEntries(audience).some(readsInScope)) ids.add(definition.id);
    }
  }
  return [...ids];
}

/**
 * The rooms and flags an event's audience reaches. An audience entry's
 * `audienceUsers({ event, options })` answers user ids through the owners'
 * APIs, once for the event however many sockets receive it. An entry whose
 * read fails, or that reads in the event's scope when no feature provides
 * `realtime.audience-scope`, is logged as an error and skipped: the event still
 * reaches the other entries' rooms.
 * @param {unknown} audience
 * @param {object} event
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {RealtimeAudienceScope | null} [dependencies.audienceScope] The contexts audienceUsers reads in;
 *   absent when the application does not register RealtimeAudienceScopeFeature.
 */
async function resolveAudienceTargets(audience, event, { logger, audienceScope }) {
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
    // readable-check: allow method-probe - data: an event's audience entry may name audienceUsers()
    if (typeof entry.audienceUsers !== "function") continue;
    if (!audienceScope && readsInScope(entry)) {
      // The boot check sees only audiences declared as they are; this one was built when the action ran.
      logger.error({ socketEvent: event?.realtime?.event ?? null, entityId: event?.entityId ?? null },
        "Realtime audience reads its users in the event's scope, which needs realtime.audience-scope: register " +
          "RealtimeAudienceScopeFeature, or mark an audience that reads public tables only with publicTablesOnly: true. " +
          "The event still reaches the audience's other rooms.");
      continue;
    }
    let userIds;
    try {
      userIds = await entry.audienceUsers({ event, options: audienceReadOptions(event, audienceScope) });
    } catch (error) {
      logger.error({ socketEvent: event?.realtime?.event ?? null, entityId: event?.entityId ?? null, error: String(error?.message || error) },
        "Realtime audienceUsers failed; the event still reaches the audience's other rooms.");
      continue;
    }
    for (const rawUserId of flattenEntries(userIds)) {
      const userId = normalizeRecordId(rawUserId, { fallback: null });
      if (userId) rooms.add(roomForUser(userId));
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
 * A refused realtime caller. The code lets a client show the English in the
 * user's language: as the error's code at a host's action boundary, and in its
 * data, which Socket.IO sends with a refused handshake.
 */
class RealtimeAuthenticationError extends AppError {
  /**
   * @param {string} message
   * @param {{ code: string }} options
   */
  constructor(message, { code }) {
    super(401, message, { code });
    this.name = "RealtimeAuthenticationError";
    this.data = Object.freeze({ code });
  }
}

function authenticationRequiredError() {
  return new RealtimeAuthenticationError("Authentication required.", { code: "AUTHENTICATION_REQUIRED" });
}

function sessionRefreshRequiredError() {
  return new RealtimeAuthenticationError("Session refresh required.", { code: "SESSION_REFRESH_REQUIRED" });
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
  actionsNeedingAudienceScope,
  authenticationRequiredError,
  createAudienceContributors,
  createSocketRequest,
  realtimeAuthenticationRequired,
  revalidateSocket,
  registerSocketAudienceBootstrap,
  resolveAudienceTargets
};
