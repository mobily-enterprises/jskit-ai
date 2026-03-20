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

export {
  normalizePermissionList,
  hasPermission
};
