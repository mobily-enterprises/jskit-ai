import Fastify from "fastify";
import { resolveRuntimeEnv } from "./server/lib/runtimeEnv.js";
import path from "node:path";

function registerFallbackHealthRoute(app) {
  app.get("/api/v1/health", async () => {
    return {
      ok: true,
      app: "__APP_NAME__"
    };
  });
}

async function registerRuntime(app, { appRoot, runtimeEnv }) {
  try {
    const platformRuntimeModule = await import("@jskit-ai/platform-server-runtime");
    if (typeof platformRuntimeModule?.createProviderRuntimeFromApp === "function") {
      const runtime = await platformRuntimeModule.createProviderRuntimeFromApp({
        appRoot,
        strict: false,
        profile: "app",
        env: runtimeEnv,
        logger: app.log,
        fastify: app
      });

      app.log.info(
        {
          routeCount: runtime.routeCount,
          providerPackages: runtime.providerPackageOrder,
          legacyPackages: runtime.legacyPackageOrder,
          legacyRuntime: runtime.legacyRuntime,
          packageOrder: runtime.packageOrder
        },
        "Registered JSKIT provider server runtime."
      );

      return {
        enabled: true,
        routeCount: runtime.routeCount
      };
    }

    const [{ createServerRuntimeFromApp, applyContributedRuntimeLifecycle }, { registerApiRouteDefinitions }] =
      await Promise.all([
        import("@jskit-ai/server-runtime-core/serverContributions"),
        import("@jskit-ai/server-runtime-core/apiRouteRegistration")
      ]);

    const legacyRuntime = await createServerRuntimeFromApp({
      appRoot,
      strict: false,
      dependencies: {
        env: runtimeEnv,
        logger: app.log,
        fastify: app,
        app
      }
    });

    const routes = Array.isArray(legacyRuntime?.routes) ? legacyRuntime.routes : [];
    if (routes.length > 0) {
      registerApiRouteDefinitions(app, {
        routes
      });
    }

    await applyContributedRuntimeLifecycle({
      app,
      runtimeResult: legacyRuntime,
      dependencies: {
        env: runtimeEnv,
        logger: app.log,
        fastify: app,
        app
      }
    });

    app.log.info(
      {
        routeCount: routes.length,
        packageOrder: legacyRuntime?.packageOrder || []
      },
      "Registered JSKIT legacy server runtime."
    );

    return {
      enabled: true,
      routeCount: routes.length
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
  const runtime = await registerRuntime(app, {
    appRoot,
    runtimeEnv
  });
  if (!runtime.enabled || runtime.routeCount < 1) {
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
