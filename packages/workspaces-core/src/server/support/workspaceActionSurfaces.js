import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveDefaultWorkspaceSurfaceId } from "../../shared/support/workspacePathModel.js";

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

function resolveWorkspaceSurfaceIdsFromAppConfig(appConfig = {}) {
  return resolveSurfaceIdsFromAppConfig(appConfig, (definition) => definition.requiresWorkspace === true);
}

function resolveWorkspaceMembershipOptionalSurfaceIdsFromAppConfig(appConfig = {}) {
  const policies = isRecord(appConfig.surfaceAccessPolicies) ? appConfig.surfaceAccessPolicies : {};

  return resolveSurfaceIdsFromAppConfig(appConfig, (definition) => {
    if (definition.requiresWorkspace !== true) {
      return false;
    }

    const policyId = String(definition.accessPolicyId || "")
      .trim()
      .toLowerCase();
    const policy = policyId && isRecord(policies[policyId]) ? policies[policyId] : {};
    return Object.hasOwn(policy, "requireWorkspaceMembership") && policy.requireWorkspaceMembership === false;
  });
}

function resolveSurfaceIdsFromAppConfig(appConfig = {}, predicate) {
  const source = isRecord(appConfig.surfaceDefinitions) ? appConfig.surfaceDefinitions : {};
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
    if (typeof predicate === "function" && predicate(definition) === true) {
      resolved.push(surfaceId);
    }
  }

  return normalizeSurfaceIds(resolved);
}

function resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig(appConfig = {}) {
  const workspaceSurfaceIds = resolveWorkspaceSurfaceIdsFromAppConfig(appConfig);
  const workspaceSurfaceSet = new Set(workspaceSurfaceIds);

  const resolvedSurfaceId = resolveDefaultWorkspaceSurfaceId({
    defaultSurfaceId: appConfig.surfaceDefaultId,
    workspaceSurfaceIds,
    surfaceRequiresWorkspace(surfaceId) {
      return workspaceSurfaceSet.has(surfaceId);
    }
  });

  return (
    normalizeSurfaceId(resolvedSurfaceId) ||
    normalizeSurfaceId(workspaceSurfaceIds[0]) ||
    normalizeSurfaceId(appConfig.surfaceDefaultId) ||
    ""
  );
}

export {
  resolveWorkspaceSurfaceIdsFromAppConfig,
  resolveWorkspaceMembershipOptionalSurfaceIdsFromAppConfig,
  resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig
};
