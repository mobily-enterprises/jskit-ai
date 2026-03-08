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
  hasPermission
};
