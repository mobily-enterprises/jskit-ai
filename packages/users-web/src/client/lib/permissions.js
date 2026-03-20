function normalizePermissionList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    )
  );
}

function toPermissionSet(values) {
  const normalized = normalizePermissionList(values);
  if (normalized.length < 1) {
    return new Set();
  }
  return new Set(normalized);
}

function arePermissionListsEqual(left, right) {
  const leftSet = toPermissionSet(left);
  const rightSet = toPermissionSet(right);
  if (leftSet.size !== rightSet.size) {
    return false;
  }

  for (const permission of leftSet) {
    if (!rightSet.has(permission)) {
      return false;
    }
  }

  return true;
}

function hasPermission(permissionList, permission) {
  const required = String(permission || "").trim();
  if (!required) {
    return true;
  }

  const source = Array.isArray(permissionList) ? permissionList : [];
  return source.includes("*") || source.includes(required);
}

export {
  normalizePermissionList,
  arePermissionListsEqual,
  hasPermission
};
