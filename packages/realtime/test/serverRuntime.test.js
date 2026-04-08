import assert from "node:assert/strict";
import test from "node:test";

import {
  REDIS_URL_ENV_KEY,
  REDIS_NAMESPACE_ENV_KEY,
  createSocketIoServer,
  closeSocketIoServer,
  resolveRealtimeRedisUrl,
  resolveRealtimeRedisNamespace,
  configureSocketIoRedisAdapter,
  closeSocketIoRedisConnections
} from "../src/server/runtime.js";

test("createSocketIoServer uses provided http server and fixed socket path", () => {
  const httpServer = {
    id: "http-server"
  };
  const calls = [];
  class FakeServer {
    constructor(server, options) {
      calls.push({
        server,
        options
      });
    }
  }

  createSocketIoServer({
    httpServer,
    options: {
      path: "ws",
      cors: {
        origin: "*"
      }
    },
    ServerCtor: FakeServer
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].server, httpServer);
  assert.deepEqual(calls[0].options, {
    path: "/socket.io",
    cors: {
      origin: "*"
    }
  });
});

test("createSocketIoServer falls back to fastify.server", () => {
  const fastifyServer = {
    id: "fastify-server"
  };
  const calls = [];
  class FakeServer {
    constructor(server) {
      calls.push(server);
    }
  }

  createSocketIoServer({
    fastify: {
      server: fastifyServer
    },
    ServerCtor: FakeServer
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0], fastifyServer);
});

test("createSocketIoServer throws when no server target is provided", () => {
  assert.throws(
    () => createSocketIoServer({ ServerCtor: class {} }),
    /requires httpServer or fastify\.server/
  );
});

test("closeSocketIoServer resolves when io closes", async () => {
  let closed = false;
  const io = {
    close(done) {
      closed = true;
      done();
    }
  };

  await closeSocketIoServer(io);
  assert.equal(closed, true);
});

test("closeSocketIoServer is a no-op without close method", async () => {
  await closeSocketIoServer(null);
  await closeSocketIoServer({});
  assert.equal(true, true);
});

test("closeSocketIoServer swallows ERR_SERVER_NOT_RUNNING", async () => {
  const io = {
    close(done) {
      const error = new Error("Server is not running.");
      error.code = "ERR_SERVER_NOT_RUNNING";
      done(error);
    }
  };

  await closeSocketIoServer(io);
  assert.equal(true, true);
});

test("resolveRealtimeRedisUrl reads and normalizes env URL", () => {
  assert.equal(resolveRealtimeRedisUrl({}), "");
  assert.equal(resolveRealtimeRedisUrl({ [REDIS_URL_ENV_KEY]: " redis://localhost:6379 " }), "redis://localhost:6379");
});

test("resolveRealtimeRedisNamespace reads and normalizes env namespace", () => {
  assert.equal(resolveRealtimeRedisNamespace({}), "");
  assert.equal(
    resolveRealtimeRedisNamespace({ [REDIS_NAMESPACE_ENV_KEY]: " app:production " }),
    "app:production"
  );
});

test("configureSocketIoRedisAdapter keeps memory mode when URL is empty", async () => {
  let adapterCalls = 0;
  const io = {
    adapter() {
      adapterCalls += 1;
    }
  };

  const result = await configureSocketIoRedisAdapter(io, {
    redisUrl: ""
  });

  assert.equal(result.enabled, false);
  assert.equal(adapterCalls, 0);
});

test("closeSocketIoRedisConnections closes both clients when present", async () => {
  const calls = [];
  const pubClient = {
    async quit() {
      calls.push("pub.quit");
    }
  };
  const subClient = {
    async quit() {
      calls.push("sub.quit");
    }
  };

  await closeSocketIoRedisConnections({
    pubClient,
    subClient
  });

  assert.deepEqual(calls, ["sub.quit", "pub.quit"]);
});

test("configureSocketIoRedisAdapter applies namespaced adapter key when redis namespace is set", async () => {
  const adapterCalls = [];
  const io = {
    adapter(adapter) {
      adapterCalls.push(adapter);
    }
  };
  const connectionCalls = [];
  const createRedisConnection = ({ url }) => {
    const client = {
      url,
      async connect() {
        connectionCalls.push(`${url}:connect`);
      },
      async quit() {},
      duplicate() {
        return {
          async connect() {
            connectionCalls.push(`${url}:duplicate.connect`);
          },
          async quit() {}
        };
      }
    };
    return client;
  };
  const createRedisAdapter = (pubClient, subClient, options) => ({
    pubClient,
    subClient,
    options
  });

  const result = await configureSocketIoRedisAdapter(io, {
    redisUrl: "redis://localhost:6379",
    redisNamespace: "my-app:production",
    createRedisConnection,
    createRedisAdapter
  });

  assert.equal(connectionCalls.length, 2);
  assert.equal(adapterCalls.length, 1);
  assert.equal(adapterCalls[0].options?.key, "my-app:production:socket.io");
  assert.equal(result.adapterKey, "my-app:production:socket.io");
  assert.equal(result.redisNamespace, "my-app:production");
});
