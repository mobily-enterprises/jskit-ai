import {
  authenticationRequiredError,
  createAudienceContributors,
  createSocketRequest,
  realtimeAuthenticationRequired,
  registerSocketAudienceBootstrap,
  revalidateSocket
} from "./realtimeAudience.js";
import { createRealtimeDelivery, matchesRealtimeEvent } from "./realtimeDelivery.js";
import { announceServedClientBuild } from "./servedClientBuild.js";
import {
  closeSocketIoRedisConnections,
  closeSocketIoServer,
  configureSocketIoRedisAdapter,
  countConnectedClients
} from "./runtime.js";

/** @typedef {import("@jskit-ai/auth-core/server/types").AuthService} AuthService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} RuntimeAppRoot */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * The `runtime.realtime` capability over one Socket.IO server. It starts
 * delivering once every provider has booted, because the auth service may be
 * ready only then, and stops with the runtime.
 * @param {object} dependencies
 * @param {import("socket.io").Server} dependencies.io
 * @param {RuntimeLogger} dependencies.logger
 * @param {AuthService | null} dependencies.authService
 * @param {RuntimeEvents} dependencies.events
 * @param {RuntimeAppRoot | null} dependencies.appRoot
 * @param {{ redisUrl: string, redisNamespace: string }} dependencies.redis
 */
function createRealtimeCapability({ io, logger, authService, events, appRoot, redis }) {
  const audiences = createAudienceContributors();
  const connectionListeners = new Set();
  let authenticationRequired = false;
  /** @type {ReturnType<typeof createRealtimeDelivery> | null} */
  let delivery = null;
  /** @type {Awaited<ReturnType<typeof configureSocketIoRedisAdapter>> | null} */
  let redisConnection = null;

  function onConnection(listener) {
    // readable-check: allow method-probe - input validation: an application hands over its connection listener
    if (typeof listener !== "function") throw new TypeError("Realtime connection listener must be a function.");
    const releases = new Map();
    function attach(socket) {
      if (releases.has(socket)) return;
      let detach;
      async function readRequest() {
        const request = createSocketRequest(socket);
        const actor = await revalidateSocket({ socket, request, authService, audiences });
        if (!socket.connected || (!actor && realtimeAuthenticationRequired(authService))) {
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
          logger.warn({ error: String(error?.message || error) }, "Realtime connection cleanup failed.");
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
        // readable-check: allow method-probe - input validation: an application's listener returns its cleanup
        if (detach != null && typeof detach !== "function") {
          throw new TypeError("Realtime connection listeners must return a cleanup function or undefined.");
        }
        releases.set(socket, release);
        socket.on("disconnect", release);
      } catch (error) {
        logger.warn({ error: String(error?.message || error) }, "Realtime connection listener failed.");
      }
    }
    function stopListening() {
      io.off("connection", attach);
      for (const release of [...releases.values()]) release();
      connectionListeners.delete(stopListening);
    }
    connectionListeners.add(stopListening);
    io.on("connection", attach);
    for (const socket of io.sockets.sockets.values()) attach(socket);
    return stopListening;
  }

  /**
   * A package that knows which scopes (kind "user", "workspace" or
   * "workspace_user") an actor belongs to registers them during setup; sockets
   * join, and on revalidation leave, exactly the rooms its scopes name.
   * @param {import("./types.js").RealtimeAudienceContributor} contributor
   */
  function registerAudienceContributor(contributor) {
    audiences.register(contributor);
  }

  function diagnostics() {
    return Object.freeze({
      authenticationRequired,
      connectedClients: countConnectedClients(io),
      redisConfigured: redisConnection?.enabled === true
    });
  }

  /**
   * Authenticates each socket and delivers every event that names a socket
   * event, to the other servers too when Redis is configured.
   */
  async function start() {
    delivery = createRealtimeDelivery({ io, logger, authService, audiences });
    authenticationRequired = realtimeAuthenticationRequired(authService);
    registerSocketAudienceBootstrap({ io, logger, authService, audiences });
    announceServedClientBuild({ io, appRoot, logger });
    redisConnection = await configureSocketIoRedisAdapter(io, { logger, ...redis });
    delivery.start({ redisConfigured: redisConnection.enabled });
    events.register({
      id: "runtime.realtime.delivery",
      matches: matchesRealtimeEvent,
      handle: delivery.handle
    });
  }

  /**
   * Closes Socket.IO's part of the HTTP server; the server's owner closes the server.
   */
  async function stop() {
    for (const release of [...connectionListeners]) release();
    if (delivery) delivery.stop();
    await closeSocketIoServer(io);
    if (redisConnection) await closeSocketIoRedisConnections(redisConnection);
    authenticationRequired = false;
    redisConnection = null;
  }

  return Object.freeze({
    onConnection,
    registerAudienceContributor,
    diagnostics,
    start,
    stop
  });
}

export { createRealtimeCapability };
