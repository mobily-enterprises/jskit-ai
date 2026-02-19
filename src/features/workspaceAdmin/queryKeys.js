function normalizeWorkspaceAdminScope(scopeValue) {
  const normalized = String(scopeValue || "").trim();
  return normalized || "none";
}

function workspaceAdminRootQueryKey() {
  return ["workspace-admin"];
}

function workspaceAdminScopeQueryKey(scopeValue) {
  return [...workspaceAdminRootQueryKey(), normalizeWorkspaceAdminScope(scopeValue)];
}

function workspaceSettingsQueryKey(scopeValue) {
  return [...workspaceAdminScopeQueryKey(scopeValue), "settings"];
}

function workspaceMembersQueryKey(scopeValue) {
  return [...workspaceAdminScopeQueryKey(scopeValue), "members"];
}

function workspaceInvitesQueryKey(scopeValue) {
  return [...workspaceAdminScopeQueryKey(scopeValue), "invites"];
}

export {
  workspaceAdminRootQueryKey,
  workspaceAdminScopeQueryKey,
  workspaceSettingsQueryKey,
  workspaceMembersQueryKey,
  workspaceInvitesQueryKey
};
