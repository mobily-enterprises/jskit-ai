function resolveMembershipRoleId(membershipLike) {
  return String(membershipLike?.roleId || "").trim();
}

function resolveMembershipStatus(membershipLike) {
  return String(membershipLike?.status || membershipLike?.membershipStatus || "active").trim() || "active";
}

function normalizeMembershipForAccess(membershipLike) {
  const roleId = resolveMembershipRoleId(membershipLike);
  if (!roleId) {
    return null;
  }

  const status = resolveMembershipStatus(membershipLike);
  if (status !== "active") {
    return null;
  }

  return {
    roleId,
    status
  };
}

function mapMembershipSummary(membershipLike) {
  return normalizeMembershipForAccess(membershipLike);
}

function normalizePermissions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map((permission) => String(permission || "").trim()).filter(Boolean)));
}

function createMembershipIndexes(memberships) {
  const byId = new Map();
  const bySlug = new Map();

  for (const membership of memberships) {
    const workspaceId = Number(membership?.id);
    const workspaceSlug = String(membership?.slug || "").trim();

    if (Number.isInteger(workspaceId) && workspaceId > 0) {
      byId.set(workspaceId, membership);
    }
    if (workspaceSlug) {
      bySlug.set(workspaceSlug, membership);
    }
  }

  return {
    byId,
    bySlug
  };
}

export {
  resolveMembershipRoleId,
  resolveMembershipStatus,
  normalizeMembershipForAccess,
  mapMembershipSummary,
  normalizePermissions,
  createMembershipIndexes
};
