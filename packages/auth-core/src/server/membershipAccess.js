import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function resolveMembershipRoleId(membershipLike) {
  return String(membershipLike?.roleSid || "").trim();
}

function resolveMembershipStatus(membershipLike) {
  return String(membershipLike?.status || membershipLike?.membershipStatus || "active").trim() || "active";
}

function normalizeMembershipForAccess(membershipLike) {
  const roleSid = resolveMembershipRoleId(membershipLike);
  if (!roleSid) {
    return null;
  }

  const status = resolveMembershipStatus(membershipLike);
  if (status !== "active") {
    return null;
  }

  return {
    roleSid,
    status
  };
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
    const workspaceId = normalizeRecordId(membership?.id, { fallback: null });
    const workspaceSlug = String(membership?.slug || "").trim();

    if (workspaceId) {
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
  normalizePermissions,
  createMembershipIndexes
};
