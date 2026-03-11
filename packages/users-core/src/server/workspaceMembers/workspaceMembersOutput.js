import { createWorkspaceRoleCatalog, OWNER_ROLE_ID } from "../../shared/roles.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeWorkspaceAdminSummary(workspace) {
  return {
    id: Number(workspace.id),
    slug: normalizeText(workspace.slug),
    name: normalizeText(workspace.name),
    ownerUserId: Number(workspace.ownerUserId),
    avatarUrl: normalizeText(workspace.avatarUrl),
    color: normalizeText(workspace.color)
  };
}

function normalizeMemberSummary(member, workspace) {
  return {
    userId: Number(member.userId),
    roleId: normalizeLowerText(member.roleId || "member") || "member",
    status: normalizeLowerText(member.status || "active") || "active",
    displayName: normalizeText(member.displayName),
    email: normalizeLowerText(member.email),
    isOwner:
      Number(member.userId) === Number(workspace.ownerUserId) ||
      normalizeLowerText(member.roleId) === OWNER_ROLE_ID
  };
}

function normalizeInviteSummary(invite) {
  return {
    id: Number(invite.id),
    email: normalizeLowerText(invite.email),
    roleId: normalizeLowerText(invite.roleId || "member") || "member",
    status: normalizeLowerText(invite.status || "pending") || "pending",
    expiresAt: invite.expiresAt,
    invitedByUserId: invite.invitedByUserId == null ? null : Number(invite.invitedByUserId)
  };
}

function createWorkspaceMembersOutput(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const workspace = source.workspace && typeof source.workspace === "object" ? source.workspace : {};
  const members = Array.isArray(source.members) ? source.members : [];

  return {
    workspace: normalizeWorkspaceAdminSummary(workspace),
    members: members.map((member) => normalizeMemberSummary(member, workspace)),
    roleCatalog: createWorkspaceRoleCatalog()
  };
}

function createWorkspaceInvitesOutput(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const workspace = source.workspace && typeof source.workspace === "object" ? source.workspace : {};
  const invites = Array.isArray(source.invites) ? source.invites : [];
  const normalized = {
    workspace: normalizeWorkspaceAdminSummary(workspace),
    invites: invites.map((invite) => normalizeInviteSummary(invite)),
    roleCatalog: createWorkspaceRoleCatalog()
  };

  if (Object.hasOwn(source, "inviteTokenPreview")) {
    normalized.inviteTokenPreview = normalizeText(source.inviteTokenPreview);
  }

  return normalized;
}

export {
  createWorkspaceMembersOutput,
  createWorkspaceInvitesOutput
};
