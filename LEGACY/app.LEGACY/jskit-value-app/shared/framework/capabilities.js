const FRAMEWORK_CAPABILITY_IDS = Object.freeze({
  authIdentity: "cap.auth.identity",
  authCookies: "cap.auth.cookies",
  rbacPermissions: "cap.rbac.permissions",
  workspaceSelection: "cap.workspace.selection",
  workspaceMembership: "cap.workspace.membership",
  httpRoutePolicy: "cap.http.route-policy",
  httpContracts: "cap.http.contracts",
  realtimePublish: "cap.realtime.publish",
  realtimeSubscribe: "cap.realtime.subscribe",
  actionRuntimeExecute: "cap.action-runtime.execute",
  billingEntitlements: "cap.billing.entitlements"
});

const FRAMEWORK_CAPABILITY_VERSION = "1.0.0";

function frameworkCapability(capabilityId, version = FRAMEWORK_CAPABILITY_VERSION) {
  return Object.freeze({
    id: String(capabilityId || "").trim(),
    version: String(version || "").trim()
  });
}

function frameworkCapabilityRequirement(capabilityId, { range = `^${FRAMEWORK_CAPABILITY_VERSION}`, optional = false } = {}) {
  const requirement = {
    id: String(capabilityId || "").trim(),
    optional: Boolean(optional)
  };

  const normalizedRange = String(range || "").trim();
  if (normalizedRange) {
    requirement.range = normalizedRange;
  }

  return Object.freeze(requirement);
}

export {
  FRAMEWORK_CAPABILITY_IDS,
  FRAMEWORK_CAPABILITY_VERSION,
  frameworkCapability,
  frameworkCapabilityRequirement
};
