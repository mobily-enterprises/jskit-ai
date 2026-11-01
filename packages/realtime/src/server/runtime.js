import { Server as SocketIoServer } from "socket.io";
import { createAdapter as createSocketIoRedisAdapter } from "@socket.io/redis-adapter";
import { createClient as createRedisClient } from "redis";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";

const SOCKET_IO_PATH = "/socket.io";
const REDIS_URL_ENV_KEY = "REDIS_URL";
const REDIS_NAMESPACE_ENV_KEY = "REDIS_NAMESPACE";

function toRequestPathname(urlValue) {
  const rawUrl = String(urlValue || "").trim() || "/";
  try {
    return normalizePathname(new URL(rawUrl, "http://localhost").pathname || "/");
  } catch {
    return normalizePathname(rawUrl.split("?")[0] || "/");
  }
}

/** @param {import("@jskit-ai/kernel/server/types").RuntimeFastify | null} fastify */
function registerSocketIoUpgradeHandoff(fastify) {
  // readable-check: allow method-probe - platform object: a host that hands over only its HTTP server ({ server }) has no addHook()
  if (typeof fastify?.addHook !== "function") return;
  fastify.addHook("onRequest", async (request, reply) => {
    if (request?.ws !== true) return;
    if (toRequestPathname(request?.raw?.url || request?.url) !== SOCKET_IO_PATH) return;
    // The WebSocket plugin also routes this upgrade through Fastify. Leave it
    // to Socket.IO instead of letting Fastify's missing-route response close it.
    reply.hijack();
  });
}

function resolveHttpServer({ httpServer = null, fastify = null } = {}) {
  if (httpServer && typeof httpServer === "object") {
    return httpServer;
  }
  if (fastify && typeof fastify === "object" && fastify.server && typeof fastify.server === "object") {
    return fastify.server;
  }
  throw new Error("createSocketIoServer requires httpServer or fastify.server.");
}

/**
 * @param {object} [options]
 * @param {import("node:http").Server | null} [options.httpServer] The HTTP server to attach to; Fastify's when absent.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify | null} [options.fastify]
 * @param {Partial<import("socket.io").ServerOptions>} [options.options]
 * @param {typeof SocketIoServer} [options.ServerCtor]
 */
function createSocketIoServer({
  httpServer = null,
  fastify = null,
  options = {},
  ServerCtor = SocketIoServer
} = {}) {
  if (typeof ServerCtor !== "function") {
    throw new Error("createSocketIoServer requires a valid socket.io Server constructor.");
  }

  const server = resolveHttpServer({
    httpServer,
    fastify
  });
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const normalizedOptions = {
    // Application WebSocket routes may still be authorizing their upgrades.
    destroyUpgrade: false,
    ...source,
    path: SOCKET_IO_PATH
  };
  registerSocketIoUpgradeHandoff(fastify);
  return new ServerCtor(server, normalizedOptions);
}

// Socket.IO runs on an HTTP server its caller owns (Fastify's, for the
// provider), which also carries other routes' WebSockets and streams.
// Server#close() would close that server and wait for every one of them, so
// close only Socket.IO's part: refuse its new requests, then close its engine
// and adapter. The server's owner closes the server. Closing the engine ends
// each client's transport, as Server#close() does, so browsers reconnect to
// the next server through Socket.IO's own reconnection.
async function closeSocketIoServer(io) {
  if (!io?.engine) {
    return;
  }
  io.engine.use((_request, _response, next) => next(new Error("Realtime has shut down.")));
  io.engine.close();
  await io.sockets.adapter.close();
}

function resolveRealtimeRedisUrl(env = {}) {
  const source = env && typeof env === "object" && !Array.isArray(env) ? env : {};
  return normalizeText(source[REDIS_URL_ENV_KEY]);
}

function resolveRealtimeRedisNamespace(env = {}) {
  const source = env && typeof env === "object" && !Array.isArray(env) ? env : {};
  return normalizeText(source[REDIS_NAMESPACE_ENV_KEY]);
}

function buildSocketIoRedisAdapterKey(redisNamespace = "") {
  const normalizedRedisNamespace = normalizeText(redisNamespace).replace(/:+$/g, "");
  if (!normalizedRedisNamespace) {
    return "";
  }
  return `${normalizedRedisNamespace}:socket.io`;
}

/**
 * @param {import("socket.io").Server} io
 * @param {object} options
 * @param {string} [options.redisUrl]
 * @param {string} [options.redisNamespace]
 * @param {import("./types.js").RealtimeLogger} options.logger Warned when a Redis connection fails.
 * @param {typeof createSocketIoRedisAdapter} [options.createRedisAdapter]
 * @param {typeof createRedisClient} [options.createRedisConnection]
 */
async function configureSocketIoRedisAdapter(
  io,
  {
    redisUrl = "",
    redisNamespace = "",
    logger,
    createRedisAdapter = createSocketIoRedisAdapter,
    createRedisConnection = createRedisClient
  }
) {
  const normalizedRedisUrl = normalizeText(redisUrl);
  const adapterKey = buildSocketIoRedisAdapterKey(redisNamespace);
  if (!normalizedRedisUrl) {
    return Object.freeze({
      enabled: false,
      redisUrl: "",
      redisNamespace: "",
      adapterKey: "",
      pubClient: null,
      subClient: null
    });
  }
  const pubClient = createRedisConnection({
    url: normalizedRedisUrl
  });
  const subClient = pubClient.duplicate();
  const reportError = (error) => logger.warn({ error: String(error?.message || error) }, "Realtime Redis connection failed.");
  pubClient.on("error", reportError);
  subClient.on("error", reportError);
  const publish = pubClient.publish.bind(pubClient);
  // The Socket.IO adapter does not await Redis publish promises.
  pubClient.publish = async (...args) => {
    try {
      return await publish(...args);
    } catch (error) {
      reportError(error);
      return 0;
    }
  };

  try {
    await pubClient.connect();
    await subClient.connect();
    const adapterOptions = adapterKey ? { key: adapterKey } : undefined;
    io.adapter(createRedisAdapter(pubClient, subClient, adapterOptions));
  } catch (error) {
    await closeSocketIoRedisConnections({
      pubClient,
      subClient
    });
    throw error;
  }

  return Object.freeze({
    enabled: true,
    redisUrl: normalizedRedisUrl,
    redisNamespace: normalizeText(redisNamespace),
    adapterKey,
    pubClient,
    subClient
  });
}

async function closeSocketIoRedisConnections({ pubClient = null, subClient = null } = {}) {
  const connections = [subClient, pubClient];
  for (const connection of connections) {
    if (!connection) {
      continue;
    }
    // readable-check: allow method-probe - platform object: a Redis client closes with quit(), or with disconnect() where it has no quit()
    if (typeof connection.quit === "function") {
      try {
        await connection.quit();
      } catch {}
      continue;
    }
    // readable-check: allow method-probe - platform object: a Redis client closes with quit(), or with disconnect() where it has no quit()
    if (typeof connection.disconnect === "function") {
      try {
        await connection.disconnect();
      } catch {}
    }
  }
}

export {
  createSocketIoServer,
  closeSocketIoServer,
  REDIS_URL_ENV_KEY,
  REDIS_NAMESPACE_ENV_KEY,
  resolveRealtimeRedisUrl,
  resolveRealtimeRedisNamespace,
  configureSocketIoRedisAdapter,
  closeSocketIoRedisConnections
};
