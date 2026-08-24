import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveAudienceTargets } from "./realtimeAudience.js";

function publicRealtimePayload(event) {
  const { realtime, ...canonical } = event && typeof event === "object" ? event : {};
  const payload = realtime?.payload;
  if (payload != null && (!payload || typeof payload !== "object" || Array.isArray(payload))) {
    throw new TypeError("Realtime event payload must be an object when provided.");
  }
  return Object.freeze({ ...(payload || {}), ...canonical });
}

function createRealtimeDelivery({ io, database = null, logger }) {
  if (!io || typeof io.emit !== "function" || typeof io.to !== "function") {
    throw new TypeError("Realtime delivery requires a Socket.IO server.");
  }
  if (!logger || typeof logger.warn !== "function") {
    throw new TypeError("Realtime delivery requires a logger.");
  }

  return Object.freeze({
    async handle(event = {}) {
      const eventName = normalizeText(event?.realtime?.event);
      if (!eventName) return;
      const targets = await resolveAudienceTargets(event.realtime.audience, event, { database, logger });
      const payload = publicRealtimePayload(event);
      if (targets.broadcastAllClients) io.emit(eventName, payload);
      for (const room of targets.rooms) io.to(room).emit(eventName, payload);
      logger.debug({
        socketEvent: eventName,
        rooms: targets.rooms,
        broadcastAllClients: targets.broadcastAllClients,
        connectedClients: Number.isInteger(Number(io?.engine?.clientsCount))
          ? Number(io.engine.clientsCount)
          : null
      }, "Realtime delivered an action event.");
    }
  });
}

export { createRealtimeDelivery };
