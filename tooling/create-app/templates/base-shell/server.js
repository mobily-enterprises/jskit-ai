import Fastify from "fastify";
import { resolveRuntimeEnv } from "./server/lib/runtimeEnv.js";
import path from "node:path";
import {
  registerSurfaceRequestConstraint,
  resolveRuntimeProfileFromSurface,
  tryCreateProviderRuntimeFromApp
} from "@jskit-ai/framework-core/platform/server";
import { createSurfaceRuntime } from "@jskit-ai/framework-core/surface/runtime";
import { SURFACE_DEFINITIONS, SURFACE_IDS, SURFACE_MODE_ALL } from "./config/surfaces.js";

const surfaceRuntime = createSurfaceRuntime({
  allMode: SURFACE_MODE_ALL,
  surfaceIds: SURFACE_IDS,
  surfaces: SURFACE_DEFINITIONS,
  defaultSurfaceId: "app"
});

async function createServer() {
  const app = Fastify({ logger: true });
  const runtimeEnv = resolveRuntimeEnv();
  registerSurfaceRequestConstraint({
    fastify: app,
    surfaceRuntime,
    serverSurface: runtimeEnv.SERVER_SURFACE
  });
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
