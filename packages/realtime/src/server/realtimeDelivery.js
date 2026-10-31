import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveAudienceTargets, revalidateSocket } from "./realtimeAudience.js";

/** @typedef {import("@jskit-ai/auth-core/server/types").AuthService} AuthService */
/** @typedef {import("./realtimeAudience.js").AudienceContributors} AudienceContributors */

const DELIVERY_EVENT = "jskit:realtime:delivery";

function publicRealtimePayload(event) {
  const { realtime } = event && typeof event === "object" ? event : {};
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
  return Object.freeze({ ...(payload || {}), ...canonical });
}

// One answer per question within one pass.
function sharedWithinPass(load, keyOf = (value) => value) {
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
 * one actor share its contributed rooms. Revalidation asks only who is signed
 * in, so the provider reads the app profile instead of synchronizing it, and
 * never refreshes a session the socket could not store.
 * @param {AuthService} authService
 * @param {AudienceContributors["resolveActorRooms"]} resolveActorRooms
 */
function createPassChecks(authService, resolveActorRooms) {
  return {
    authenticateRequest: sharedWithinPass(
      (request) => authService.authenticateRequest(request, { syncProfile: false, refreshSession: false }),
      JSON.stringify
    ),
    audiences: { resolveActorRooms: sharedWithinPass(resolveActorRooms) }
  };
}

/**
 * @param {object} dependencies
 * @param {import("socket.io").Server} dependencies.io
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase | null} dependencies.database Absent when no runtime.database is installed.
 * @param {import("@jskit-ai/kernel/shared/support/providerLogger").ProviderLogger} dependencies.logger
 * @param {AuthService | null} dependencies.authService Absent when no auth.service is installed.
 * @param {AudienceContributors} dependencies.audiences The rooms revalidation may make a socket join.
 *   With no contributors registered, a socket stays in the rooms it already has.
 */
function createRealtimeDelivery({ io, database, logger, authService, audiences: { mayContribute, resolveActorRooms } }) {
  // readable-check: allow method-probe - a test asserts the error an auth.service without authenticateRequest() raises below
  const guarded = typeof authService?.authenticateRequest === "function";
  // readable-check: allow method-probe - a test asserts this error; input validation: an auth provider's realtime policy may name authorizeEvent()
  if (authService?.realtime?.authorizeEvent != null && typeof authService.realtime.authorizeEvent !== "function") {
    throw new TypeError("Realtime authorizeEvent must be a function.");
  }
  if ((authService?.realtime?.requireAuthentication === true || authService?.realtime?.authorizeEvent) && !guarded) {
    throw new TypeError("Realtime authorization requires auth.service.authenticateRequest().");
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

  // A socket outside every target room can enter one only by revalidation
  // joining a contributed room; otherwise checking it cannot change delivery.
  function candidateSockets(targets) {
    const sockets = [...io.sockets.sockets.values()];
    if (targets.broadcastAllClients || targets.rooms.some((room) => mayContribute(room))) return sockets;
    return sockets.filter((socket) => targets.rooms.some((room) => socket.rooms.has(room)));
  }

  async function deliverLocal({ eventName, payload, targets }) {
    const checks = createPassChecks(authService, resolveActorRooms);
    await Promise.all(candidateSockets(targets).map(async (socket) => {
      try {
        const actor = await revalidate(socket, checks);
        if (!socket.connected) return;
        if (!targets.broadcastAllClients && !targets.rooms.some((room) => socket.rooms.has(room))) return;
        // readable-check: allow method-probe - authorizeEvent is an optional part of the auth.service realtime policy
        if (typeof authService.realtime?.authorizeEvent === "function") {
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
      const checks = createPassChecks(authService, resolveActorRooms);
      await Promise.all([...io.sockets.sockets.values()].map((socket) => revalidate(socket, checks)));
      scheduleRevalidation();
    }, 30_000);
    revalidationTimer.unref();
  }

  return Object.freeze({
    start({ redisConfigured = false } = {}) {
      redisEnabled = redisConfigured;
      if (guarded) {
        io.on(DELIVERY_EVENT, receive);
        scheduleRevalidation();
      }
    },
    stop() {
      stopped = true;
      clearTimeout(revalidationTimer);
      if (guarded) io.off(DELIVERY_EVENT, receive);
    },
    async handle(event = {}) {
      try {
        const eventName = normalizeText(event?.realtime?.event);
        if (!eventName) return;
        const targets = await resolveAudienceTargets(event.realtime.audience, event, { database, logger });
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
          connectedClients: Number.isInteger(Number(io?.engine?.clientsCount))
            ? Number(io.engine.clientsCount)
            : null
        }, "Realtime delivered an action event.");
      } catch (error) {
        logger.warn({ socketEvent: event?.realtime?.event, error: String(error?.message || error) }, "Realtime delivery failed; the domain mutation remains successful.");
      }
    }
  });
}

export { createRealtimeDelivery };
