import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveAudienceTargets, revalidateSocket } from "./realtimeAudience.js";
import { countConnectedClients } from "./runtime.js";

/** @typedef {import("@jskit-ai/auth-core/server/types").AuthService} AuthService */
/** @typedef {import("./types.js").ActorRoomsResolver} ActorRoomsResolver */
/** @typedef {import("./types.js").ActorsRoomsResolver} ActorsRoomsResolver */
/** @typedef {import("./types.js").AudienceContributors} AudienceContributors */

const DELIVERY_EVENT = "jskit:realtime:delivery";

function publicRealtimePayload(event) {
  const { realtime } = event;
  const canonical = {};
  for (const key of [
    "type", "source", "entity", "operation", "entityId", "scope", "actorId",
    "commandId", "sourceClientId", "occurredAt"
  ]) {
    if (Object.hasOwn(event, key)) canonical[key] = event[key];
  }
  const payload = realtime?.payload;
  if (payload != null && (typeof payload !== "object" || Array.isArray(payload))) {
    throw new TypeError("Realtime event payload must be an object when provided.");
  }
  return Object.freeze({
    ...(payload || {}),
    ...canonical
  });
}

/** One answer per question within one pass. */
function sharedWithinPass(load, keyOf) {
  const answers = new Map();
  return (value) => {
    const key = keyOf(value);
    if (!answers.has(key)) answers.set(key, (async () => load(value))());
    return answers.get(key);
  };
}

/**
 * The checks of one publish or 30-second pass. Identical socket requests share
 * one authentication (the auth service sees only the request), and sockets of
 * one actor share its contributed rooms. The rooms of the actors a pass names
 * up front are one bulk resolution, which the sockets it revalidates then
 * share, so no actor's rooms are looked up twice in a pass. Revalidation asks
 * only who is signed in, so the provider reads the app profile instead of
 * synchronizing it, and never refreshes a session the socket could not store.
 * @param {AuthService} authService
 * @param {ActorsRoomsResolver} resolveActorsRooms
 */
function createPassChecks(authService, resolveActorsRooms) {
  const roomLookups = new Map();

  /** @param {Iterable<string>} actorIds Resolved together, except those this pass already has. */
  function lookUpActorsRooms(actorIds) {
    const unknown = [...new Set(actorIds)].filter((actorId) => !roomLookups.has(actorId));
    if (unknown.length === 0) return;
    const lookup = (async () => resolveActorsRooms(unknown))();
    // A failed lookup fails each revalidation that waits for it, not the process.
    lookup.catch(() => {});
    for (const actorId of unknown) roomLookups.set(actorId, lookup);
  }

  /** @type {ActorRoomsResolver} */
  async function resolveActorRooms(actorId) {
    lookUpActorsRooms([actorId]);
    return (await roomLookups.get(actorId)).get(actorId);
  }

  return Object.freeze({
    authenticateRequest: sharedWithinPass(
      (request) => authService.authenticateRequest(request, { syncProfile: false, refreshSession: false }),
      JSON.stringify
    ),
    lookUpActorsRooms,
    audiences: Object.freeze({ resolveActorRooms })
  });
}

/**
 * The actor a socket signed in as, when it did.
 * @param {import("socket.io").Socket} socket
 */
function rememberedActorId(socket) {
  return socket.data.actorId || null;
}

/**
 * @param {object} dependencies
 * @param {import("socket.io").Server} dependencies.io
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {AuthService | null} dependencies.authService Absent when no auth.service is installed.
 * @param {AudienceContributors} dependencies.audiences The rooms revalidation may make a socket join.
 *   With no contributors registered, a socket stays in the rooms it already has.
 */
function createRealtimeDelivery({ io, logger, authService, audiences: { mayContribute, resolveActorsRooms } }) {
  // With an auth.service, each socket is revalidated before it receives an event;
  // without one, events go straight to their rooms.
  const guarded = Boolean(authService);
  const authorizeEvent = authService?.realtime?.authorizeEvent ?? null;
  // readable-check: allow method-probe - input validation: an auth provider's realtime policy may name authorizeEvent()
  if (authorizeEvent !== null && typeof authorizeEvent !== "function") {
    throw new TypeError("Realtime authorizeEvent must be a function.");
  }
  let redisEnabled = false;
  let revalidationTimer = null;
  let stopped = false;

  async function revalidate(socket, checks) {
    try {
      return await revalidateSocket({
        socket,
        authService,
        audiences: checks.audiences,
        authenticateRequest: checks.authenticateRequest
      });
    } catch (error) {
      socket.disconnect(true);
      logger.warn({ error: String(error?.message || error) }, "Realtime socket revalidation failed.");
      return null;
    }
  }

  /**
   * The sockets that can receive the event, and so are revalidated before it.
   * A socket outside every target room can enter one only by revalidation
   * joining a contributed room, and the rooms it joins are exactly its actor's
   * (a socket whose login now names another actor is disconnected instead). So
   * a socket outside is checked only when its actor's rooms, one bulk lookup
   * for every outside actor, include a target, or when it has no actor yet and
   * may sign in now. Any other socket is left to the 30-second pass.
   * @param {{ broadcastAllClients: boolean, rooms: readonly string[] }} targets
   * @param {ReturnType<typeof createPassChecks>} checks
   */
  async function candidateSockets(targets, checks) {
    const sockets = [...io.sockets.sockets.values()];
    if (targets.broadcastAllClients) return sockets;
    const inTargets = (socket) => targets.rooms.some((room) => socket.rooms.has(room));
    const contributable = targets.rooms.filter((room) => mayContribute(room));
    if (contributable.length === 0) return sockets.filter(inTargets);

    // The rooms of every signed-in socket's actor, inside or outside, in one lookup.
    checks.lookUpActorsRooms(sockets.map(rememberedActorId).filter(Boolean));
    const entering = await Promise.all(sockets.map(async (socket) => {
      if (inTargets(socket)) return true;
      const actorId = rememberedActorId(socket);
      if (!actorId) return true;
      try {
        const rooms = await checks.audiences.resolveActorRooms(actorId);
        return contributable.some((room) => rooms.has(room));
      } catch {
        // Revalidating it meets the same failure and disconnects it, as before.
        return true;
      }
    }));
    return sockets.filter((_socket, index) => entering[index]);
  }

  async function deliverLocal({ eventName, payload, targets }) {
    const checks = createPassChecks(authService, resolveActorsRooms);
    const candidates = await candidateSockets(targets, checks);
    checks.lookUpActorsRooms(candidates.map(rememberedActorId).filter(Boolean));
    await Promise.all(candidates.map(async (socket) => {
      try {
        const actor = await revalidate(socket, checks);
        if (!socket.connected) return;
        if (!targets.broadcastAllClients && !targets.rooms.some((room) => socket.rooms.has(room))) return;
        if (authorizeEvent) {
          const authorized = await authService.realtime.authorizeEvent({
            actor,
            event: { name: eventName, payload }
          });
          if (authorized !== true) return;
        }
        if (socket.connected) socket.emit(eventName, payload);
      } catch (error) {
        logger.warn({ socketEvent: eventName, error: String(error?.message || error) }, "Realtime delivery denied after authorization failure.");
      }
    }));
  }

  async function receive(envelope) {
    try {
      await deliverLocal(envelope);
    } catch (error) {
      logger.warn({ error: String(error?.message || error) }, "Realtime peer delivery failed.");
    }
  }

  function scheduleRevalidation() {
    if (stopped) return;
    revalidationTimer = setTimeout(async () => {
      const checks = createPassChecks(authService, resolveActorsRooms);
      const sockets = [...io.sockets.sockets.values()];
      checks.lookUpActorsRooms(sockets.map(rememberedActorId).filter(Boolean));
      await Promise.all(sockets.map((socket) => revalidate(socket, checks)));
      scheduleRevalidation();
    }, 30_000);
    revalidationTimer.unref();
  }

  function start({ redisConfigured = false } = {}) {
    redisEnabled = redisConfigured;
    if (guarded) {
      io.on(DELIVERY_EVENT, receive);
      scheduleRevalidation();
    }
  }

  function stop() {
    stopped = true;
    clearTimeout(revalidationTimer);
    if (guarded) io.off(DELIVERY_EVENT, receive);
  }

  /** @param {object} event A published runtime event whose realtime part names a socket event (see matchesRealtimeEvent). */
  async function handle(event) {
    try {
      const eventName = normalizeText(event.realtime.event);
      const targets = await resolveAudienceTargets(event.realtime.audience, event, { logger });
      const payload = publicRealtimePayload(event);
      if (guarded) {
        const envelope = { eventName, payload, targets };
        if (redisEnabled) {
          try {
            io.serverSideEmit(DELIVERY_EVENT, envelope);
          } catch (error) {
            logger.warn({ socketEvent: eventName, error: String(error?.message || error) }, "Realtime peer publication failed.");
          }
        }
        await deliverLocal(envelope);
      } else if (targets.broadcastAllClients) {
        io.emit(eventName, payload);
      } else if (targets.rooms.length) {
        io.to(targets.rooms).emit(eventName, payload);
      }
      logger.debug({
        socketEvent: eventName,
        rooms: targets.rooms,
        broadcastAllClients: targets.broadcastAllClients,
        connectedClients: countConnectedClients(io)
      }, "Realtime delivered an action event.");
    } catch (error) {
      logger.warn({ socketEvent: event.realtime?.event, error: String(error?.message || error) }, "Realtime delivery failed; the domain mutation remains successful.");
    }
  }

  return Object.freeze({
    start,
    stop,
    handle
  });
}

/**
 * Whether a published runtime event names a socket event for realtime to deliver.
 * @param {object} event
 */
function matchesRealtimeEvent(event) {
  return Boolean(normalizeText(event.realtime?.event));
}

export { createRealtimeDelivery, matchesRealtimeEvent };
