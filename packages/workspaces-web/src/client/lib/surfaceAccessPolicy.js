import { resolveSurfaceDefinitionFromPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import {
  normalizeRecord,
  normalizeWorkspaceBootstrapStatusValue
} from "../support/runtimeNormalization.js";
import { hasPermission, normalizePermissionList } from "./permissions.js";

const WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND = "not_found";
const WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN = "forbidden";
const WORKSPACE_ACCESS_BLOCKING_STATUSES = new Set([
  WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND,
  WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN
]);

function normalizeSurfaceAccessPolicyId(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeWorkspaceSlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeAccessFlagName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeStringList(value) {
  const source = Array.isArray(value) ? value : [value];
  const output = [];
  for (const entry of source) {
    const normalizedEntry = normalizeAccessFlagName(entry);
    if (!normalizedEntry || output.includes(normalizedEntry)) {
      continue;
    }
    output.push(normalizedEntry);
  }
  return output;
}

function normalizeSurfaceAccessFlags(value = null) {
  const source = normalizeRecord(value);
  const flags = {};

  for (const [candidateKey, candidateValue] of Object.entries(source)) {
    const key = normalizeAccessFlagName(candidateKey);
    if (!key) {
      continue;
    }
    flags[key] = candidateValue === true;
  }

  return flags;
}

function hasPlacementValue(source, key) {
  if (!source || typeof source !== "object") {
    return false;
  }
  return Object.hasOwn(source, key);
}

function hasKnownWorkspaceMembershipContext(contextValue = null) {
  return hasPlacementValue(contextValue, "workspaces");
}

function hasKnownPermissionsContext(contextValue = null) {
  return hasPlacementValue(contextValue, "permissions");
}

function hasKnownSurfaceAccessContext(contextValue = null) {
  return hasPlacementValue(contextValue, "surfaceAccess");
}

function hasWorkspaceMembership(contextValue = null, workspaceSlug = "") {
  const normalizedWorkspaceSlug = normalizeWorkspaceSlug(workspaceSlug);
  if (!normalizedWorkspaceSlug) {
    return false;
  }

  const context = normalizeRecord(contextValue);
  if (normalizeWorkspaceSlug(context?.workspace?.slug) === normalizedWorkspaceSlug) {
    return true;
  }

  const workspaces = Array.isArray(context.workspaces) ? context.workspaces : [];
  for (const workspace of workspaces) {
    if (normalizeWorkspaceSlug(workspace?.slug) === normalizedWorkspaceSlug) {
      return true;
    }
  }

  return false;
}

function resolveSurfaceAccessPolicies(contextValue = null) {
  const context = normalizeRecord(contextValue);
  const configuredPolicies = normalizeRecord(context.surfaceAccessPolicies);
  const policies = {};

  for (const [candidatePolicyId, candidatePolicy] of Object.entries(configuredPolicies)) {
    const policyId = normalizeSurfaceAccessPolicyId(candidatePolicyId);
    if (!policyId) {
      continue;
    }
    policies[policyId] = normalizeRecord(candidatePolicy);
  }

  return policies;
}

function resolveSurfaceAccessPolicy(contextValue = null, surfaceDefinition = null) {
  const definition = normalizeRecord(surfaceDefinition);
  const policyId = normalizeSurfaceAccessPolicyId(definition.accessPolicyId);
  const configuredPolicies = resolveSurfaceAccessPolicies(contextValue);
  const configuredPolicy = policyId ? normalizeRecord(configuredPolicies[policyId]) : {};

  const requireAuth = Object.hasOwn(configuredPolicy, "requireAuth")
    ? configuredPolicy.requireAuth === true
    : definition.requiresAuth === true;
  const requireWorkspaceMembership = Object.hasOwn(configuredPolicy, "requireWorkspaceMembership")
    ? configuredPolicy.requireWorkspaceMembership === true
    : definition.requiresWorkspace === true;
  const requireAnyPermissions = normalizePermissionList(configuredPolicy.requireAnyPermissions);
  const requireAllPermissions = normalizePermissionList(configuredPolicy.requireAllPermissions);
  const requireFlagsAny = normalizeStringList(configuredPolicy.requireFlagsAny);
  const requireFlagsAll = normalizeStringList(configuredPolicy.requireFlagsAll);

  return Object.freeze({
    policyId,
    requireAuth,
    requireWorkspaceMembership,
    requireAnyPermissions: Object.freeze([...requireAnyPermissions]),
    requireAllPermissions: Object.freeze([...requireAllPermissions]),
    requireFlagsAny: Object.freeze([...requireFlagsAny]),
    requireFlagsAll: Object.freeze([...requireFlagsAll])
  });
}

function toAccessDecision({ allowed = false, pending = false, reason = "" } = {}) {
  return Object.freeze({
    allowed: allowed === true,
    pending: pending === true,
    reason: String(reason || "").trim()
  });
}

function evaluatePermissionRequirements(policy, permissions = []) {
  if (policy.requireAnyPermissions.length > 0) {
    const hasAnyRequiredPermission = policy.requireAnyPermissions.some((permission) => hasPermission(permissions, permission));
    if (!hasAnyRequiredPermission) {
      return toAccessDecision({
        allowed: false,
        reason: "surface-access-missing-any-permission"
      });
    }
  }

  if (policy.requireAllPermissions.length > 0) {
    for (const permission of policy.requireAllPermissions) {
      if (hasPermission(permissions, permission)) {
        continue;
      }
      return toAccessDecision({
        allowed: false,
        reason: "surface-access-missing-permission"
      });
    }
  }

  return toAccessDecision({
    allowed: true
  });
}

function evaluateFlagRequirements(policy, flags = {}) {
  const normalizedFlags = normalizeSurfaceAccessFlags(flags);
  if (policy.requireFlagsAll.length > 0) {
    for (const flagName of policy.requireFlagsAll) {
      if (normalizedFlags[flagName] === true) {
        continue;
      }
      return toAccessDecision({
        allowed: false,
        reason: "surface-access-missing-flag"
      });
    }
  }

  if (policy.requireFlagsAny.length > 0) {
    const hasAnyRequiredFlag = policy.requireFlagsAny.some((flagName) => normalizedFlags[flagName] === true);
    if (!hasAnyRequiredFlag) {
      return toAccessDecision({
        allowed: false,
        reason: "surface-access-missing-any-flag"
      });
    }
  }

  return toAccessDecision({
    allowed: true
  });
}

function evaluateSurfaceAccess({
  context = null,
  surfaceId = "",
  workspaceSlug = "",
  allowOnUnknown = false
} = {}) {
  const source = normalizeRecord(context);
  const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
  if (!normalizedSurfaceId) {
    return toAccessDecision({
      allowed: false,
      reason: "surface-access-invalid-surface"
    });
  }

  const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(source, normalizedSurfaceId);
  if (!surfaceDefinition || surfaceDefinition.enabled === false) {
    return toAccessDecision({
      allowed: false,
      reason: "surface-access-disabled"
    });
  }

  const policy = resolveSurfaceAccessPolicy(source, surfaceDefinition);
  if (policy.requireAuth && source?.auth?.authenticated !== true) {
    return toAccessDecision({
      allowed: false,
      reason: "surface-access-auth-required"
    });
  }

  const normalizedWorkspaceSlug = normalizeWorkspaceSlug(workspaceSlug);
  if (policy.requireWorkspaceMembership) {
    if (!normalizedWorkspaceSlug) {
      return toAccessDecision({
        allowed: false,
        reason: "surface-access-workspace-required"
      });
    }

    const workspaceBootstrapStatuses = normalizeRecord(source.workspaceBootstrapStatuses);
    const workspaceStatus = normalizeWorkspaceBootstrapStatusValue(
      workspaceBootstrapStatuses[normalizedWorkspaceSlug],
      WORKSPACE_ACCESS_BLOCKING_STATUSES
    );
    if (workspaceStatus === WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND) {
      return toAccessDecision({
        allowed: false,
        reason: "surface-access-workspace-not-found"
      });
    }
    if (workspaceStatus === WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN) {
      return toAccessDecision({
        allowed: false,
        reason: "surface-access-workspace-forbidden"
      });
    }

    if (hasKnownWorkspaceMembershipContext(source)) {
      if (!hasWorkspaceMembership(source, normalizedWorkspaceSlug)) {
        if (allowOnUnknown && !workspaceStatus) {
          return toAccessDecision({
            allowed: true,
            pending: true
          });
        }
        return toAccessDecision({
          allowed: false,
          reason: "surface-access-workspace-membership-required"
        });
      }
    } else if (allowOnUnknown) {
      return toAccessDecision({
        allowed: true,
        pending: true
      });
    } else {
      return toAccessDecision({
        allowed: false,
        pending: true,
        reason: "surface-access-pending"
      });
    }
  }

  const placementPermissions = normalizePermissionList(source.permissions);
  if (policy.requireAnyPermissions.length > 0 || policy.requireAllPermissions.length > 0) {
    if (!hasKnownPermissionsContext(source)) {
      if (allowOnUnknown) {
        return toAccessDecision({
          allowed: true,
          pending: true
        });
      }
      return toAccessDecision({
        allowed: false,
        pending: true,
        reason: "surface-access-pending"
      });
    }

    const permissionDecision = evaluatePermissionRequirements(policy, placementPermissions);
    if (!permissionDecision.allowed) {
      return permissionDecision;
    }
  }

  if (policy.requireFlagsAny.length > 0 || policy.requireFlagsAll.length > 0) {
    if (!hasKnownSurfaceAccessContext(source)) {
      if (allowOnUnknown) {
        return toAccessDecision({
          allowed: true,
          pending: true
        });
      }
      return toAccessDecision({
        allowed: false,
        pending: true,
        reason: "surface-access-pending"
      });
    }

    const accessFlags = normalizeRecord(source.surfaceAccess);
    const flagDecision = evaluateFlagRequirements(policy, accessFlags);
    if (!flagDecision.allowed) {
      return flagDecision;
    }
  }

  return toAccessDecision({
    allowed: true
  });
}

export {
  hasWorkspaceMembership,
  resolveSurfaceAccessPolicy,
  evaluateSurfaceAccess
};
