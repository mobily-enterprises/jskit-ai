function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeDenyUserIds(rawUserIds) {
  if (!Array.isArray(rawUserIds)) {
    return [];
  }

  return Array.from(
    new Set(rawUserIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))
  );
}

function normalizeDenyEmails(rawEmails) {
  if (!Array.isArray(rawEmails)) {
    return [];
  }

  return Array.from(new Set(rawEmails.map((value) => normalizeEmail(value)).filter(Boolean)));
}

function extractAppSurfacePolicy(workspaceSettings) {
  const features =
    workspaceSettings?.features && typeof workspaceSettings.features === "object" ? workspaceSettings.features : {};
  const surfaceAccess =
    features.surfaceAccess && typeof features.surfaceAccess === "object" ? features.surfaceAccess : {};
  const appPolicy = surfaceAccess.app && typeof surfaceAccess.app === "object" ? surfaceAccess.app : {};

  return {
    denyUserIds: normalizeDenyUserIds(appPolicy.denyUserIds),
    denyEmails: normalizeDenyEmails(appPolicy.denyEmails)
  };
}

function canAccessWorkspace(context = {}) {
  const user = context.user && typeof context.user === "object" ? context.user : null;
  if (!user) {
    return {
      allowed: false,
      reason: "authentication_required",
      permissions: []
    };
  }

  const membership = context.membership && typeof context.membership === "object" ? context.membership : null;
  const membershipRoleId = String(membership?.roleId || "").trim();
  const membershipStatus = String(membership?.status || "active").trim() || "active";
  if (!membershipRoleId || membershipStatus !== "active") {
    return {
      allowed: false,
      reason: "membership_required",
      permissions: []
    };
  }

  const policy = extractAppSurfacePolicy(context.workspaceSettings);
  const userId = Number(user.id);
  const userEmail = normalizeEmail(user.email);

  if (policy.denyUserIds.includes(userId)) {
    return {
      allowed: false,
      reason: "user_denied",
      permissions: []
    };
  }

  if (userEmail && policy.denyEmails.includes(userEmail)) {
    return {
      allowed: false,
      reason: "email_denied",
      permissions: []
    };
  }

  const rolePermissions =
    typeof context.resolvePermissions === "function" ? context.resolvePermissions(membershipRoleId) : [];

  return {
    allowed: true,
    reason: "allowed",
    permissions: Array.from(
      new Set(
        (Array.isArray(rolePermissions) ? rolePermissions : [])
          .map((permission) => String(permission || "").trim())
          .filter(Boolean)
      )
    )
  };
}

export { canAccessWorkspace, extractAppSurfacePolicy };
