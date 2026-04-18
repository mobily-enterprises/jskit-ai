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

function resolveWorkspacePolicyOverrides(appConfig = {}) {
  const tenancyPolicy = isRecord(appConfig?.tenancyPolicy) ? appConfig.tenancyPolicy : {};
  const workspacePolicy = isRecord(tenancyPolicy.workspace) ? tenancyPolicy.workspace : {};

  return Object.freeze({
    allowSelfCreate: typeof workspacePolicy.allowSelfCreate === "boolean" ? workspacePolicy.allowSelfCreate : null
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
    autoProvision: false,
    allowSelfCreate: overrides.allowSelfCreate === true,
    slugPolicy: WORKSPACE_SLUG_POLICY_USER_SELECTED
  });
}

function resolveTenancyProfile(appConfig = {}) {
  const mode = normalizeTenancyMode(appConfig?.tenancyMode);
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
  resolveTenancyProfile,
  isWorkspacesTenancyMode
};
