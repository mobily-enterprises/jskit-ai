import { loadEnvFile } from "./envFile.js";
import { surfaceRuntime } from "./surfaceRuntime.js";

const DEFAULT_PORT = 3000;

/**
 * The port a value names, else the fallback.
 * @param {string | undefined} value
 * @param {number} fallback
 */
function toPort(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

/** The process environment, with .env loaded and SERVER_SURFACE, PORT and HOST resolved. */
function resolveRuntimeEnv() {
  loadEnvFile();
  const serverSurface = surfaceRuntime.normalizeSurfaceMode(
    process.env.JSKIT_SERVER_SURFACE || process.env.SERVER_SURFACE
  );
  return {
    ...process.env,
    SERVER_SURFACE: serverSurface,
    PORT: toPort(process.env.PORT, DEFAULT_PORT),
    HOST: String(process.env.HOST || "").trim() || "0.0.0.0"
  };
}

export { DEFAULT_PORT, resolveRuntimeEnv };
