function collectInviteWorkspaceIds(invites) {
  return Array.from(
    new Set(
      (Array.isArray(invites) ? invites : [])
        .map((invite) => Number(invite?.workspaceId))
        .filter((workspaceId) => Number.isInteger(workspaceId) && workspaceId > 0)
    )
  );
}

async function listInviteMembershipsByWorkspaceId({ workspaceMembershipsRepository, userId, invites }) {
  const workspaceIds = collectInviteWorkspaceIds(invites);
  if (workspaceIds.length < 1) {
    return new Map();
  }

  if (typeof workspaceMembershipsRepository?.listByUserIdAndWorkspaceIds === "function") {
    const memberships = await workspaceMembershipsRepository.listByUserIdAndWorkspaceIds(userId, workspaceIds);
    const membershipByWorkspaceId = new Map();

    for (const membership of memberships) {
      const workspaceId = Number(membership?.workspaceId);
      if (Number.isInteger(workspaceId) && workspaceId > 0 && !membershipByWorkspaceId.has(workspaceId)) {
        membershipByWorkspaceId.set(workspaceId, membership);
      }
    }

    return membershipByWorkspaceId;
  }

  const membershipByWorkspaceId = new Map();
  for (const workspaceId of workspaceIds) {
    const membership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspaceId, userId);
    if (membership) {
      membershipByWorkspaceId.set(workspaceId, membership);
    }
  }

  return membershipByWorkspaceId;
}

export { collectInviteWorkspaceIds, listInviteMembershipsByWorkspaceId };
