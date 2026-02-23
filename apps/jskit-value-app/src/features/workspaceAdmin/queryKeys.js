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

function workspaceBillingPlansQueryKey(scopeValue) {
  return [...workspaceAdminScopeQueryKey(scopeValue), "billing", "plans"];
}

function workspaceBillingSubscriptionQueryKey(scopeValue) {
  return [...workspaceAdminScopeQueryKey(scopeValue), "billing", "subscription"];
}

function workspaceBillingPlanStateQueryKey(scopeValue) {
  return [...workspaceAdminScopeQueryKey(scopeValue), "billing", "plan-state"];
}

function workspaceBillingProductsQueryKey(scopeValue) {
  return [...workspaceAdminScopeQueryKey(scopeValue), "billing", "products"];
}

function workspaceBillingPurchasesQueryKey(scopeValue) {
  return [...workspaceAdminScopeQueryKey(scopeValue), "billing", "purchases"];
}

function workspaceBillingLimitationsQueryKey(scopeValue) {
  return [...workspaceAdminScopeQueryKey(scopeValue), "billing", "limitations"];
}

function workspaceBillingTimelineQueryKey(scopeValue, filters = {}) {
  const normalizedFilters = filters && typeof filters === "object" ? filters : {};
  return [...workspaceAdminScopeQueryKey(scopeValue), "billing", "timeline", normalizedFilters];
}

export {
  workspaceAdminRootQueryKey,
  workspaceAdminScopeQueryKey,
  workspaceSettingsQueryKey,
  workspaceMembersQueryKey,
  workspaceInvitesQueryKey,
  workspaceBillingPlansQueryKey,
  workspaceBillingSubscriptionQueryKey,
  workspaceBillingPlanStateQueryKey,
  workspaceBillingProductsQueryKey,
  workspaceBillingPurchasesQueryKey,
  workspaceBillingLimitationsQueryKey,
  workspaceBillingTimelineQueryKey
};
