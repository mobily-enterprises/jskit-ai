import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveAudienceTargets, revalidateSocket } from "./realtimeAudience.js";

const DELIVERY_EVENT = "jskit:realtime:delivery";

function publicRealtimePayload(event) {
  const { realtime } = event && typeof event === "object" ? event : {};
  const canonical = {};
  for (const key of ["type", "source", "entity", "operation", "entityId", "scope", "actorId", "commandId", "sourceClientId", "occurredAt"]) {
    if (Object.hasOwn(event, key)) canonical[key] = event[key];
  }
  const payload = realtime?.payload;
  if (payload != null && (!payload || typeof payload !== "object" || Array.isArray(payload))) {
    throw new TypeError("Realtime event payload must be an object when provided.");
  }
  return Object.freeze({ ...(payload || {}), ...canonical });
}

function createRealtimeDelivery({ io, database = null, logger, authService = null, workspaces = null }) {
  if (!io || typeof io.emit !== "function" || typeof io.to !== "function") {
    throw new TypeError("Realtime delivery requires a Socket.IO server.");
  }
  if (!logger || typeof logger.warn !== "function") {
    throw new TypeError("Realtime delivery requires a logger.");
  }

  const guarded = typeof authService?.authenticateRequest === "function";
  if (authService?.realtime?.authorizeEvent != null && typeof authService.realtime.authorizeEvent !== "function") {
    throw new TypeError("Realtime authorizeEvent must be a function.");
  }
  if ((authService?.realtime?.requireAuthentication === true || authService?.realtime?.authorizeEvent) && !guarded) {
    throw new TypeError("Realtime authorization requires auth.service.authenticateRequest().");
  }
  let redisEnabled = false;
  let revalidationTimer = null;
  let stopped = false;

  async function authenticate(socket) {
    try {
      return await revalidateSocket({ socket, authService, workspaces });
    } catch (error) {
      socket.disconnect(true);
      logger.warn({ error: String(error?.message || error) }, "Realtime socket revalidation failed.");
      return null;
    }
  }

  async function deliverLocal({ eventName, payload, targets }) {
    await Promise.all([...io.sockets.sockets.values()].map(async (socket) => {
      try {
        const actor = await authenticate(socket);
        if (!socket.connected) return;
        if (!targets.broadcastAllClients && !targets.rooms.some((room) => socket.rooms.has(room))) return;
        if (typeof authService.realtime?.authorizeEvent === "function" &&
            await authService.realtime.authorizeEvent({ actor, event: { name: eventName, payload } }) !== true) return;
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
      await Promise.all([...io.sockets.sockets.values()].map(authenticate));
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
