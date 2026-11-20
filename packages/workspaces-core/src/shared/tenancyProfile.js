import {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACES,
  normalizeTenancyMode
} from "./tenancyMode.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

const WORKSPACE_SLUG_POLICY_NONE = "none";
const WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME = "immutable_username";
const WORKSPACE_SLUG_POLICY_USER_SELECTED = "user_selected";
// autoProvision's third value: a personal workspace only for a person who is no active member of any workspace and
// whose sign-in carries no invitation they can use.
const WORKSPACE_AUTO_PROVISION_UNLESS_MEMBER = "unless-member";

function resolveAutoProvisionOverride(value) {
  if (value === undefined || typeof value === "boolean" || value === WORKSPACE_AUTO_PROVISION_UNLESS_MEMBER) {
    return value ?? null;
  }
  throw new TypeError(
    `tenancyPolicy.workspace.autoProvision must be true, false or "${WORKSPACE_AUTO_PROVISION_UNLESS_MEMBER}". Received: ${String(value)}`
  );
}

function resolveWorkspacePolicyOverrides(appConfig = {}) {
  const tenancyPolicy = isRecord(appConfig.tenancyPolicy) ? appConfig.tenancyPolicy : {};
  const workspacePolicy = isRecord(tenancyPolicy.workspace) ? tenancyPolicy.workspace : {};

  return Object.freeze({
    allowSelfCreate: typeof workspacePolicy.allowSelfCreate === "boolean" ? workspacePolicy.allowSelfCreate : null,
    autoProvision: resolveAutoProvisionOverride(workspacePolicy.autoProvision)
  });
}

function resolveWorkspacePolicy(mode, overrides = {}) {
  if (mode === TENANCY_MODE_NONE) {
    return Object.freeze({
      enabled: false,
      autoProvision: false,
      allowSelfCreate: false,
      slugPolicy: WORKSPACE_SLUG_POLICY_NONE
    });
  }

  if (mode === TENANCY_MODE_PERSONAL) {
    return Object.freeze({
      enabled: true,
      autoProvision: true,
      allowSelfCreate: false,
      slugPolicy: WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME
    });
  }

  return Object.freeze({
    enabled: true,
    autoProvision: overrides.autoProvision ?? false,
    allowSelfCreate: overrides.allowSelfCreate === true,
    slugPolicy: WORKSPACE_SLUG_POLICY_USER_SELECTED
  });
}

function resolveTenancyProfile(appConfig = {}) {
  const mode = normalizeTenancyMode(appConfig.tenancyMode);
  const workspacePolicyOverrides = resolveWorkspacePolicyOverrides(appConfig);

  return Object.freeze({
    mode,
    workspace: resolveWorkspacePolicy(mode, workspacePolicyOverrides)
  });
}

function isWorkspacesTenancyMode(value = "") {
  return normalizeTenancyMode(value) === TENANCY_MODE_WORKSPACES;
}

export {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACES,
  normalizeTenancyMode,
  WORKSPACE_SLUG_POLICY_NONE,
  WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME,
  WORKSPACE_SLUG_POLICY_USER_SELECTED,
  WORKSPACE_AUTO_PROVISION_UNLESS_MEMBER,
  resolveTenancyProfile,
  isWorkspacesTenancyMode
};
