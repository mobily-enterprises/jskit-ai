import { normalizeText } from "./normalize.js";

function normalizePermissionList(value) {
  const source = Array.isArray(value) ? value : [value];
  const unique = new Set();

  for (const entry of source) {
    const normalizedEntry = normalizeText(entry);
    if (!normalizedEntry) {
      continue;
    }
    unique.add(normalizedEntry);
  }

  return [...unique];
}

function hasPermission(permissionSet = [], permission = "") {
  const requiredPermission = normalizeText(permission);
  if (!requiredPermission) {
    return true;
  }

  const permissions = normalizePermissionList(permissionSet);
  if (permissions.includes("*") || permissions.includes(requiredPermission)) {
    return true;
  }

  for (const grantedPermission of permissions) {
    if (!grantedPermission.endsWith(".*")) {
      continue;
    }

    const wildcardNamespace = grantedPermission.slice(0, -2);
    if (!wildcardNamespace) {
      continue;
    }

    if (requiredPermission.startsWith(`${wildcardNamespace}.`)) {
      return true;
    }
  }

  return false;
}

/**
 * What an actor's permissions lack for a requirement that names permissions: null
 * when they satisfy it; under "all", the first missing permission; under "any",
 * the required permissions, none of which it has.
 * @param {"all" | "any"} mode
 * @param {ReadonlyArray<string>} requiredPermissions
 * @param {ReadonlyArray<string>} actorPermissions
 * @returns {{ permission: string } | { requiredPermissions: ReadonlyArray<string> } | null}
 */
function missingPermissionDetails(mode, requiredPermissions, actorPermissions) {
  if (mode === "all") {
    const permission = requiredPermissions.find((entry) => !hasPermission(actorPermissions, entry));
    return permission === undefined ? null : { permission };
  }
  return requiredPermissions.some((entry) => hasPermission(actorPermissions, entry)) ? null : { requiredPermissions };
}

export {
  normalizePermissionList,
  hasPermission,
  missingPermissionDetails
};
