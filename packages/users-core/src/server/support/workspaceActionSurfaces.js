import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeWorkspaceSurfaceIds(workspaceSurfaceIds = []) {
  const source = Array.isArray(workspaceSurfaceIds) ? workspaceSurfaceIds : [];
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

function resolveWorkspaceSurfaceIdsFromAppConfig(appConfig = {}) {
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
      resolved.push(surfaceId);
    }
  }

  return normalizeWorkspaceSurfaceIds(resolved);
}

function materializeWorkspaceActionSurfaces(actions = [], { workspaceSurfaceIds = [] } = {}) {
  const sourceActions = Array.isArray(actions) ? actions : [];
  const resolvedWorkspaceSurfaceIds = normalizeWorkspaceSurfaceIds(workspaceSurfaceIds);
  const materialized = [];

  for (const entry of sourceActions) {
    const action = isRecord(entry) ? entry : {};
    const surfacesFrom = String(action.surfacesFrom || "")
      .trim()
      .toLowerCase();
    if (surfacesFrom !== "workspace") {
      materialized.push(action);
      continue;
    }

    if (resolvedWorkspaceSurfaceIds.length < 1) {
      continue;
    }

    const { surfacesFrom: _ignored, ...rest } = action;
    materialized.push({
      ...rest,
      surfaces: [...resolvedWorkspaceSurfaceIds]
    });
  }

  return Object.freeze(materialized.map((entry) => Object.freeze({ ...entry })));
}

function materializeWorkspaceActionSurfacesFromAppConfig(actions = [], { appConfig = {} } = {}) {
  const workspaceSurfaceIds = resolveWorkspaceSurfaceIdsFromAppConfig(appConfig);
  return materializeWorkspaceActionSurfaces(actions, { workspaceSurfaceIds });
}

export {
  resolveWorkspaceSurfaceIdsFromAppConfig,
  materializeWorkspaceActionSurfaces,
  materializeWorkspaceActionSurfacesFromAppConfig
};
