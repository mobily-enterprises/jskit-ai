import { Server as SocketIoServer } from "socket.io";
import { createAdapter as createSocketIoRedisAdapter } from "@socket.io/redis-adapter";
import { createClient as createRedisClient } from "redis";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const SOCKET_IO_PATH = "/socket.io";
const REDIS_URL_ENV_KEY = "REDIS_URL";
const REDIS_NAMESPACE_ENV_KEY = "REDIS_NAMESPACE";

function resolveHttpServer({ httpServer = null, fastify = null } = {}) {
  if (httpServer && typeof httpServer === "object") {
    return httpServer;
  }
  if (fastify && typeof fastify === "object" && fastify.server && typeof fastify.server === "object") {
    return fastify.server;
  }
  throw new Error("createSocketIoServer requires httpServer or fastify.server.");
}

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
    ...source,
    path: SOCKET_IO_PATH
  };
  return new ServerCtor(server, normalizedOptions);
}

async function closeSocketIoServer(io) {
  if (!io || typeof io.close !== "function") {
    return;
  }
  await new Promise((resolve, reject) => {
    io.close((error) => {
      if (error) {
        if (error.code === "ERR_SERVER_NOT_RUNNING") {
          resolve();
          return;
        }
        reject(error);
        return;
      }
      resolve();
    });
  });
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

async function configureSocketIoRedisAdapter(
  io,
  {
    redisUrl = "",
    redisNamespace = "",
    createRedisAdapter = createSocketIoRedisAdapter,
    createRedisConnection = createRedisClient
  } = {}
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
  if (!io || typeof io.adapter !== "function") {
    throw new Error("configureSocketIoRedisAdapter requires socket.io server instance with adapter().");
  }

  const pubClient = createRedisConnection({
    url: normalizedRedisUrl
  });
  const subClient = pubClient.duplicate();

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
    if (typeof connection.quit === "function") {
      try {
        await connection.quit();
      } catch {}
      continue;
    }
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
