import Fastify from "fastify";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import { registerTypeBoxFormats } from "@jskit-ai/http-runtime/shared/validators/typeboxFormats";
import { resolveRuntimeEnv } from "./server/lib/runtimeEnv.js";
import path from "node:path";
import {
  registerSurfaceRequestConstraint,
  resolveRuntimeProfileFromSurface,
  tryCreateProviderRuntimeFromApp
} from "@jskit-ai/kernel/server/platform";
import { surfaceRuntime } from "./server/lib/surfaceRuntime.js";

async function createServer() {
  const app = Fastify({ logger: true });
  registerTypeBoxFormats();
  app.setValidatorCompiler(TypeBoxValidatorCompiler);

  app.get("/api/v1/health", async () => {
    return {
      ok: true,
      app: "__APP_NAME__"
    };
  });
  const runtimeEnv = resolveRuntimeEnv();
  const appRoot = path.resolve(process.cwd());
  const runtime = await tryCreateProviderRuntimeFromApp({
    appRoot,
    strict: false,
    profile: resolveRuntimeProfileFromSurface({
      surfaceRuntime,
      serverSurface: runtimeEnv.SERVER_SURFACE,
      defaultProfile: "app"
    }),
    env: runtimeEnv,
    logger: app.log,
    fastify: app
  });

  registerSurfaceRequestConstraint({
    fastify: app,
    surfaceRuntime,
    serverSurface: runtimeEnv.SERVER_SURFACE,
    globalUiPaths: runtime?.globalUiPaths || []
  });

  if (runtime) {
    app.log.info(
      {
        routeCount: runtime.routeCount,
        surface: surfaceRuntime.normalizeSurfaceMode(runtimeEnv.SERVER_SURFACE),
        providerPackages: runtime.providerPackageOrder,
        packageOrder: runtime.packageOrder
      },
      "Registered JSKIT provider server runtime."
    );
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
