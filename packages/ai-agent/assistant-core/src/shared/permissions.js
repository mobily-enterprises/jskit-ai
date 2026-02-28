function defaultHasPermission(permissionSet, permission) {
  const required = String(permission || "").trim();
  if (!required) {
    return true;
  }

  const values = Array.isArray(permissionSet) ? permissionSet : [];
  const normalized = values.map((value) => String(value || "").trim()).filter(Boolean);
  return normalized.includes("*") || normalized.includes(required);
}

export { defaultHasPermission };
