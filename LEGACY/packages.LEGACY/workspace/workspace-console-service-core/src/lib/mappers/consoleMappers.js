function mapMembershipSummary(membership) {
  if (!membership || typeof membership !== "object") {
    return null;
  }

  const roleId = String(membership.roleId || "").trim();
  const status = String(membership.status || "active").trim() || "active";
  if (!roleId) {
    return null;
  }

  return {
    roleId,
    status
  };
}

function mapMember(member) {
  if (!member || typeof member !== "object") {
    return null;
  }

  return {
    userId: Number(member.userId),
    email: String(member.user?.email || ""),
    displayName: String(member.user?.displayName || ""),
    roleId: String(member.roleId || ""),
    status: String(member.status || "active"),
    isConsole: String(member.roleId || "") === "console"
  };
}

function mapInvite(invite) {
  if (!invite || typeof invite !== "object") {
    return null;
  }

  return {
    id: Number(invite.id),
    email: String(invite.email || ""),
    roleId: String(invite.roleId || ""),
    status: String(invite.status || ""),
    expiresAt: String(invite.expiresAt || ""),
    invitedByUserId: invite.invitedByUserId == null ? null : Number(invite.invitedByUserId),
    invitedByDisplayName: String(invite.invitedBy?.displayName || ""),
    invitedByEmail: String(invite.invitedBy?.email || "")
  };
}

function mapPendingInvite(invite) {
  const mapped = mapInvite(invite);
  if (!mapped) {
    return null;
  }

  return {
    ...mapped,
    token: String(invite.token || "")
  };
}

export { mapMembershipSummary, mapMember, mapInvite, mapPendingInvite };
