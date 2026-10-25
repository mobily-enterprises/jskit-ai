import { existsSync } from "node:fs";
import { surfaceRuntime } from "./surfaceRuntime.js";

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
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
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
