import {
  createSocketRequest,
  realtimeAuthenticationRequired,
  revalidateSocket
} from "./realtimeAudience.js";

const stateByCapability = new WeakMap();

// The kernel's code for this English, so a client can show it in the user's language.
function authenticationRequiredError() {
  return Object.assign(new Error("Authentication required."), { statusCode: 401, code: "AUTHENTICATION_REQUIRED" });
}

// The `runtime.realtime` capability over one Socket.IO server. The provider
// keeps the state its lifecycle fills in stateByCapability, keyed by it.
/**
 * @param {object} dependencies
 * @param {import("socket.io").Server} dependencies.io
 */
function createRealtimeCapability({ io }) {
  const capability = Object.freeze({
    onConnection(listener) {
      if (typeof listener !== "function") throw new TypeError("Realtime connection listener must be a function.");
      const state = stateByCapability.get(capability);
      if (!state) throw new Error("Realtime runtime state is unavailable.");
      const releases = new Map();
      function attach(socket) {
        if (releases.has(socket)) return;
        let detach;
        async function readRequest() {
          const request = createSocketRequest(socket);
          const actor = await revalidateSocket({
            socket, request, authService: state.authService, audiences: state.audiences
          });
          if (!socket.connected || (!actor && realtimeAuthenticationRequired(state.authService))) {
            throw authenticationRequiredError();
          }
          if (actor) request.user = actor;
          return request;
        }
        function release() {
          socket.off("disconnect", release);
          releases.delete(socket);
          try { detach?.(); }
          catch (error) {
            state.providerLogger.warn({ error: String(error?.message || error) }, "Realtime connection cleanup failed.");
          }
        }
        try {
          detach = listener({
            socket,
            // Hosts authorize this real connection request through their own
            // action boundary. Reading it alone does not grant local access.
            readRequest,
            async authenticate() {
              const request = await readRequest();
              if (!request.user) throw authenticationRequiredError();
              return request;
            }
          });
          if (detach != null && typeof detach !== "function") {
            throw new TypeError("Realtime connection listeners must return a cleanup function or undefined.");
          }
          releases.set(socket, release);
          socket.on("disconnect", release);
        } catch (error) {
          state.providerLogger.warn({ error: String(error?.message || error) }, "Realtime connection listener failed.");
        }
      }
      function stop() {
        io.off("connection", attach);
        for (const release of [...releases.values()]) release();
        state.connectionListeners.delete(stop);
      }
      state.connectionListeners.add(stop);
      io.on("connection", attach);
      for (const socket of io.sockets.sockets.values()) attach(socket);
      return stop;
    },
    // A package that knows which scopes (kind "user", "workspace" or
    // "workspace_user") an actor belongs to registers them during setup; sockets
    // join, and on revalidation leave, exactly the rooms its scopes name.
    registerAudienceContributor(contributor) {
      const state = stateByCapability.get(capability);
      if (!state) throw new Error("Realtime runtime state is unavailable.");
      state.audiences.register(contributor);
    },
    diagnostics() {
      const state = stateByCapability.get(capability);
      return Object.freeze({
        authenticationRequired: state?.authenticationRequired === true,
        connectedClients: Number.isInteger(Number(io?.engine?.clientsCount))
          ? Number(io.engine.clientsCount)
          : null,
        redisConfigured: state?.redisConnection?.enabled === true
      });
    }
  });
  return capability;
}

export { createRealtimeCapability, stateByCapability };
