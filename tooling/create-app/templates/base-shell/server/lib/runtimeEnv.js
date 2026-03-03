import { createRequire } from "node:module";
import { createSurfaceRuntime } from "@jskit-ai/framework-core/surface/runtime";
import { SURFACE_DEFAULT_ID, SURFACE_DEFINITIONS, SURFACE_IDS, SURFACE_MODE_ALL } from "../../config/surfaces.js";

const require = createRequire(import.meta.url);
const surfaceRuntime = createSurfaceRuntime({
  allMode: SURFACE_MODE_ALL,
  surfaceIds: SURFACE_IDS,
  surfaces: SURFACE_DEFINITIONS,
  defaultSurfaceId: SURFACE_DEFAULT_ID
});

function toPort(value, fallback = 3000) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

let envLoaded = false;

function ensureRuntimeEnvLoaded() {
  if (envLoaded) {
    return;
  }
  try {
    const dotenvModule = require("dotenv");
    const loadDotEnv = dotenvModule?.config;
    if (typeof loadDotEnv === "function") {
      loadDotEnv();
    }
  } catch {
    // dotenv is optional in base-shell; bundles can add it when needed.
  }
  envLoaded = true;
}

function resolveRuntimeEnv() {
  ensureRuntimeEnvLoaded();
  const serverSurface = surfaceRuntime.normalizeSurfaceMode(
    process.env.JSKIT_SERVER_SURFACE || process.env.SERVER_SURFACE
  );
  return {
    ...process.env,
    SERVER_SURFACE: serverSurface,
    PORT: toPort(process.env.PORT, 3000),
    HOST: String(process.env.HOST || "").trim() || "0.0.0.0"
  };
}

export { resolveRuntimeEnv };
