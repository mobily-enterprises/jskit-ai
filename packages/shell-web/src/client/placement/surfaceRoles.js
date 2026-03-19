import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const EMPTY_SURFACE_ROLES = Object.freeze({
  defaultRole: "",
  roles: Object.freeze([]),
  surfaceIdByRole: Object.freeze({}),
  rolesBySurfaceId: Object.freeze({})
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSurfaceRole(value = "") {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "";
  }
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function normalizeSurfaceIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const candidate of value) {
    const surfaceId = normalizeSurfaceId(candidate);
    if (!surfaceId || seen.has(surfaceId)) {
      continue;
    }
    seen.add(surfaceId);
    normalized.push(surfaceId);
  }
  return normalized;
}

function buildRolesBySurfaceId(surfaceIdByRole = {}) {
  const grouped = {};
  for (const [role, surfaceId] of Object.entries(surfaceIdByRole)) {
    if (!Object.hasOwn(grouped, surfaceId)) {
      grouped[surfaceId] = [];
    }
    grouped[surfaceId].push(role);
  }

  const normalized = {};
  for (const [surfaceId, roles] of Object.entries(grouped)) {
    normalized[surfaceId] = Object.freeze([...roles].sort((left, right) => left.localeCompare(right)));
  }
  return Object.freeze(normalized);
}

function normalizeSurfaceRolesConfig(value = {}, { enabledSurfaceIds = [], defaultSurfaceId = "" } = {}) {
  const source = isRecord(value) ? value : {};
  const enabledSet = new Set(normalizeSurfaceIdList(enabledSurfaceIds));
  const normalizedDefaultSurfaceId = normalizeSurfaceId(defaultSurfaceId);
  const surfaceIdByRole = {};

  for (const [rawRole, rawSurfaceId] of Object.entries(source)) {
    const role = normalizeSurfaceRole(rawRole);
    if (!role || Object.hasOwn(surfaceIdByRole, role)) {
      continue;
    }

    const surfaceId = normalizeSurfaceId(rawSurfaceId);
    if (!surfaceId) {
      continue;
    }
    if (enabledSet.size > 0 && !enabledSet.has(surfaceId)) {
      continue;
    }

    surfaceIdByRole[role] = surfaceId;
  }

  const normalizedSurfaceIdByRole = Object.freeze({
    ...surfaceIdByRole
  });
  const roles = Object.freeze(Object.keys(surfaceIdByRole).sort((left, right) => left.localeCompare(right)));
  const rolesBySurfaceId = buildRolesBySurfaceId(surfaceIdByRole);

  return Object.freeze({
    defaultRole:
      normalizedDefaultSurfaceId && Array.isArray(rolesBySurfaceId[normalizedDefaultSurfaceId])
        ? rolesBySurfaceId[normalizedDefaultSurfaceId][0] || ""
        : "",
    roles,
    surfaceIdByRole: normalizedSurfaceIdByRole,
    rolesBySurfaceId
  });
}

function buildSurfaceRolesContext({ appConfig = {}, surfaceConfig = {} } = {}) {
  const source = isRecord(appConfig) ? appConfig : {};
  const base = normalizeSurfaceRolesConfig(source.surfaceRoles, {
    enabledSurfaceIds: surfaceConfig?.enabledSurfaceIds,
    defaultSurfaceId: surfaceConfig?.defaultSurfaceId
  });

  const configuredDefaultRole = normalizeSurfaceRole(source.surfaceDefaultRole);
  if (configuredDefaultRole && Object.hasOwn(base.surfaceIdByRole, configuredDefaultRole)) {
    return Object.freeze({
      ...base,
      defaultRole: configuredDefaultRole
    });
  }

  return base;
}

function resolveSurfaceIdForRole(surfaceRoles = EMPTY_SURFACE_ROLES, role = "") {
  const normalizedRole = normalizeSurfaceRole(role);
  if (!normalizedRole) {
    return "";
  }
  return normalizeSurfaceId(surfaceRoles?.surfaceIdByRole?.[normalizedRole] || "");
}

function readPlacementSurfaceRoles(contextValue = null) {
  const contextRecord = isRecord(contextValue) ? contextValue : {};
  const surfaceConfig = isRecord(contextRecord.surfaceConfig) ? contextRecord.surfaceConfig : {};

  return normalizeSurfaceRolesConfig(contextRecord.surfaceRoles, {
    enabledSurfaceIds: surfaceConfig.enabledSurfaceIds,
    defaultSurfaceId: surfaceConfig.defaultSurfaceId
  });
}

export {
  EMPTY_SURFACE_ROLES,
  normalizeSurfaceRole,
  normalizeSurfaceRolesConfig,
  buildSurfaceRolesContext,
  resolveSurfaceIdForRole,
  readPlacementSurfaceRoles
};
