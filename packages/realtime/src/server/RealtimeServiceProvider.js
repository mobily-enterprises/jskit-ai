import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  createSocketIoServer,
  closeSocketIoServer,
  resolveRealtimeRedisUrl,
  configureSocketIoRedisAdapter,
  closeSocketIoRedisConnections
} from "./runtime.js";
import {
  REALTIME_RUNTIME_SERVER_TOKEN,
  REALTIME_SOCKET_IO_SERVER_TOKEN
} from "./tokens.js";

const REALTIME_RUNTIME_SERVER_API = Object.freeze({
  createSocketIoServer,
  closeSocketIoServer
});
class RealtimeServiceProvider {
  static id = REALTIME_RUNTIME_SERVER_TOKEN;

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("RealtimeServiceProvider requires application singleton().");
    }

    app.singleton(REALTIME_RUNTIME_SERVER_TOKEN, () => REALTIME_RUNTIME_SERVER_API);
    app.singleton(REALTIME_SOCKET_IO_SERVER_TOKEN, (scope) => {
      const fastify = scope.make(KERNEL_TOKENS.Fastify);
      return createSocketIoServer({
        fastify
      });
    });
  }

  async boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("RealtimeServiceProvider requires application make().");
    }

    this.socketIoServer = app.make(REALTIME_SOCKET_IO_SERVER_TOKEN);
    const env = typeof app.has === "function" && app.has(KERNEL_TOKENS.Env) ? app.make(KERNEL_TOKENS.Env) : {};
    const redisUrl = resolveRealtimeRedisUrl(env);
    this.redisConnection = await configureSocketIoRedisAdapter(this.socketIoServer, {
      redisUrl
    });
  }

  async shutdown() {
    if (!this.socketIoServer) {
      return;
    }
    await closeSocketIoServer(this.socketIoServer);
    await closeSocketIoRedisConnections(this.redisConnection || {});
    this.redisConnection = null;
    this.socketIoServer = null;
  }
}

export {
  RealtimeServiceProvider
};
