import Fastify from "fastify";
import SerializerSelector from "@fastify/fast-json-stringify-compiler";
import { createCachedResponseSerializerFactory } from "@jskit-ai/kernel/server/http";
import fastifyStatic from "@fastify/static";
import { resolveRuntimeEnv } from "./server/lib/runtimeEnv.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  createInstalledRuntime,
  registerSurfaceRequestConstraint,
  resolveRuntimeProfileFromSurface
} from "@jskit-ai/kernel/server/platform";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";
import {
  API_BASE_PATH,
  matchesPathPrefix,
  normalizePathname,
  toRequestPathname
} from "@jskit-ai/kernel/shared/surface/paths";
import { surfaceRuntime } from "./server/lib/surfaceRuntime.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const SPA_INDEX_FILE = "index.html";
const STATIC_GLOBAL_UI_PATHS = Object.freeze([
  "/assets",
  "/favicon.svg",
  "/favicon.ico",
  "/robots.txt",
  "/manifest.webmanifest"
]);

function isApiPath(pathname) {
  return matchesPathPrefix(pathname, API_BASE_PATH);
}

function hasFileExtension(pathname) {
  return path.extname(normalizePathname(pathname)) !== "";
}

function buildGlobalUiPaths(runtimeGlobalUiPaths) {
  const paths = new Set(runtimeGlobalUiPaths);
  for (const staticPath of STATIC_GLOBAL_UI_PATHS) {
    paths.add(staticPath);
  }
  return [...paths];
}

function toStaticFilePath(pathname) {
  const normalizedPathname = normalizePathname(pathname);

  const relativePath = normalizedPathname.replace(/^\/+/, "");
  if (!relativePath || relativePath.endsWith("/")) {
    return "";
  }

  const normalizedRelativePath = path.posix.normalize(relativePath);
  if (
    !normalizedRelativePath ||
    normalizedRelativePath === "." ||
    normalizedRelativePath === ".." ||
    normalizedRelativePath.startsWith("../") ||
    normalizedRelativePath.includes("/../")
  ) {
    return "";
  }

  return normalizedRelativePath;
}

function canServeStaticFile(distRoot, relativePath) {
  if (!distRoot || !relativePath) {
    return false;
  }

  const normalizedDistRoot = path.resolve(distRoot);
  const resolvedPath = path.resolve(normalizedDistRoot, relativePath);
  if (!(resolvedPath === normalizedDistRoot || resolvedPath.startsWith(`${normalizedDistRoot}${path.sep}`))) {
    return false;
  }

  return existsSync(resolvedPath);
}

/**
 * The application's Fastify server with its installed JSKIT runtime, for the environment given.
 * @param {{ runtimeEnv: RuntimeEnv }} settings
 */
async function createServer({ runtimeEnv }) {
  const app = Fastify({
    logger: true,
    schemaController: {
      compilersFactory: {
        buildSerializer: createCachedResponseSerializerFactory(SerializerSelector())
      }
    },
    ajv: {
      customOptions: {
        allowUnionTypes: true
      }
    }
  });

  app.get("/api/health", async () => {
    return {
      ok: true,
      app: "reading-room"
    };
  });
  const appRoot = path.resolve(process.cwd());
  const distRoot = path.resolve(appRoot, "dist");
  const hasWebBuild = existsSync(path.resolve(distRoot, SPA_INDEX_FILE));
  const spaDocument = hasWebBuild ? readFileSync(path.resolve(distRoot, SPA_INDEX_FILE), "utf8") : "";
  const runtime = await createInstalledRuntime({
    appRoot,
    profile: resolveRuntimeProfileFromSurface({
      surfaceRuntime,
      serverSurface: runtimeEnv.SERVER_SURFACE
    }),
    config: await loadAppConfigFromAppRoot({ appRoot }),
    env: runtimeEnv,
    logger: app.log,
    fastify: app
  });

  registerSurfaceRequestConstraint({
    fastify: app,
    surfaceRuntime,
    serverSurface: runtimeEnv.SERVER_SURFACE,
    globalUiPaths: buildGlobalUiPaths(runtime.globalUiPaths)
  });

  if (hasWebBuild) {
    await app.register(fastifyStatic, {
      root: distRoot,
      index: false,
      serve: false
    });
  } else {
    app.log.warn("Frontend build not found (dist/index.html). Page routes will return 404 until `npm run build`.");
  }

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = toRequestPathname(request.url);
    const method = request.method;
    if (isApiPath(pathname) || (method !== "GET" && method !== "HEAD")) {
      return reply.code(404).send({
        message: `Route ${method}:${pathname} not found`,
        error: "Not Found",
        statusCode: 404
      });
    }
    if (hasFileExtension(pathname)) {
      const staticFilePath = toStaticFilePath(pathname);
      if (hasWebBuild && staticFilePath && canServeStaticFile(distRoot, staticFilePath)) {
        return reply.sendFile(staticFilePath);
      }
      return reply.code(404).send({
        message: `Route ${method}:${pathname} not found`,
        error: "Not Found",
        statusCode: 404
      });
    }
    if (!hasWebBuild) {
      return reply.code(404).send({
        error: "Frontend build is not available. Run `npm run build`."
      });
    }
    return reply.type("text/html; charset=utf-8").send(spaDocument);
  });

  app.log.info(
    {
      surface: surfaceRuntime.normalizeSurfaceMode(runtimeEnv.SERVER_SURFACE),
      providerPackages: runtime.providerPackageOrder,
      packageOrder: runtime.packageOrder,
      capabilities: runtime.diagnostics.capabilityIds
    },
    "Started JSKIT installed runtime."
  );

  return app;
}

/**
 * Starts the server on the host and port given, else on the environment's HOST and PORT.
 * @param {{ host?: string, port?: number }} [options]
 */
async function startServer({ host, port } = {}) {
  const runtimeEnv = resolveRuntimeEnv();
  const listenHost = host || runtimeEnv.HOST;
  const listenPort = port ?? Number(runtimeEnv.PORT);
  const app = await createServer({
    runtimeEnv: {
      ...runtimeEnv,
      HOST: listenHost,
      PORT: String(listenPort)
    }
  });
  await app.listen({ port: listenPort, host: listenHost });
  return app;
}

export { createServer, startServer };
