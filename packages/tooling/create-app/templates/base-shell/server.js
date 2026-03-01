import Fastify from "fastify";
import { resolveRuntimeEnv } from "./server/lib/runtimeEnv.js";
import { registerApiRouteDefinitions } from "@jskit-ai/server-runtime-core/apiRouteRegistration";
import { createServerRuntimeFromApp, applyContributedRuntimeLifecycle } from "@jskit-ai/server-runtime-core/serverContributions";
import path from "node:path";

function registerFallbackHealthRoute(app) {
  app.get("/api/v1/health", async () => {
    return {
      ok: true,
      app: "__APP_NAME__"
    };
  });
}

async function registerContributedRuntime(app, { appRoot, runtimeEnv }) {
  try {
    const composed = await createServerRuntimeFromApp({
      appRoot,
      strict: false,
      dependencies: {
        env: runtimeEnv,
        logger: app.log
      },
      routeConfig: {}
    });

    const routeCount = Array.isArray(composed.routes) ? composed.routes.length : 0;
    if (routeCount > 0) {
      registerApiRouteDefinitions(app, {
        routes: composed.routes
      });
    }

    const lifecycleResult = await applyContributedRuntimeLifecycle({
      app,
      runtimeResult: composed,
      dependencies: {
        env: runtimeEnv,
        logger: app.log
      }
    });

    app.log.info(
      {
        routeCount,
        pluginCount: lifecycleResult.pluginCount,
        workerCount: lifecycleResult.workerCount,
        onBootCount: lifecycleResult.onBootCount,
        packageOrder: composed.packageOrder
      },
      "Registered JSKIT contributed server runtime."
    );

    return {
      enabled: true,
      routeCount,
      pluginCount: lifecycleResult.pluginCount,
      workerCount: lifecycleResult.workerCount,
      onBootCount: lifecycleResult.onBootCount
    };
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("Lock file not found:")) {
      return {
        enabled: false,
        routeCount: 0
      };
    }
    throw error;
  }
}

async function createServer() {
  const app = Fastify({ logger: true });
  const runtimeEnv = resolveRuntimeEnv();
  const appRoot = path.resolve(process.cwd());
  const contributed = await registerContributedRuntime(app, {
    appRoot,
    runtimeEnv
  });
  if (!contributed.enabled || contributed.routeCount < 1) {
    registerFallbackHealthRoute(app);
  }

  return app;
}

async function startServer(options = {}) {
  const runtimeEnv = resolveRuntimeEnv();
  const port = Number(options?.port) || runtimeEnv.PORT;
  const host = String(options?.host || "").trim() || runtimeEnv.HOST;
  const app = await createServer();
  await app.listen({ port, host });
  return app;
}

export { createServer, startServer };
