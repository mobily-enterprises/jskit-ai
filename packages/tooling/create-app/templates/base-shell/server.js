import Fastify from "fastify";
import { resolveRuntimeEnv } from "./server/lib/runtimeEnv.js";

function createServer() {
  const app = Fastify({ logger: true });

  app.get("/api/v1/health", async () => {
    return {
      ok: true,
      app: "__APP_NAME__"
    };
  });

  return app;
}

async function startServer(options = {}) {
  const runtimeEnv = resolveRuntimeEnv();
  const port = Number(options?.port) || runtimeEnv.PORT;
  const host = String(options?.host || "").trim() || runtimeEnv.HOST;
  const app = createServer();
  await app.listen({ port, host });
  return app;
}

export { createServer, startServer };
