import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { isRecord, normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";

const CONSOLE_OWNER_ACCESS_POLICY_ID = "console_owner";

function normalizeSurfaceIds(surfaceIds = []) {
  const source = Array.isArray(surfaceIds) ? surfaceIds : [];
  const seen = new Set();
  const normalized = [];

  for (const candidate of source) {
    const surfaceId = normalizeSurfaceId(candidate);
    if (!surfaceId || seen.has(surfaceId)) {
      continue;
    }
    seen.add(surfaceId);
    normalized.push(surfaceId);
  }

  return normalized;
}

function resolveConsoleSurfaceIdsFromAppConfig(appConfig = {}) {
  const source = isRecord(appConfig?.surfaceDefinitions) ? appConfig.surfaceDefinitions : {};
  const resolved = [];

  for (const [key, value] of Object.entries(source)) {
    const definition = isRecord(value) ? value : {};
    const surfaceId = normalizeSurfaceId(definition.id || key);
    if (!surfaceId) {
      continue;
    }
    if (definition.enabled === false) {
      continue;
    }
    if (definition.requiresWorkspace === true) {
      continue;
    }
    if (normalizeLowerText(definition.accessPolicyId) !== CONSOLE_OWNER_ACCESS_POLICY_ID) {
      continue;
    }
    resolved.push(surfaceId);
  }

  return normalizeSurfaceIds(resolved);
}

function registerConsoleCoreActionSurfaceSources(app) {
  if (!app || typeof app.actionSurfaceSource !== "function") {
    return;
  }

  app.actionSurfaceSource("console", ({ scope }) => {
    const appConfig = scope?.has?.("appConfig") ? scope.make("appConfig") : {};
    return resolveConsoleSurfaceIdsFromAppConfig(appConfig);
  });
}

export {
  resolveConsoleSurfaceIdsFromAppConfig,
  registerConsoleCoreActionSurfaceSources
};
