function canAccessWorkspace(context = {}) {
  const membership = context.membership && typeof context.membership === "object" ? context.membership : null;
  const isActiveMember = membership && String(membership.status || "active") === "active";

  if (!isActiveMember) {
    return {
      allowed: false,
      reason: "membership_required",
      permissions: []
    };
  }

  const permissions =
    typeof context.resolvePermissions === "function" ? context.resolvePermissions(membership.roleId) : [];

  return {
    allowed: true,
    reason: "allowed",
    permissions
  };
}

export { canAccessWorkspace };
