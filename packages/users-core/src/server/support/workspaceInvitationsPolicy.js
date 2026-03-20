import {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  normalizeTenancyMode
} from "../../shared/tenancyMode.js";

function normalizeWorkspaceInvitationsConfig(appConfig = {}) {
  const source = appConfig && typeof appConfig === "object" && !Array.isArray(appConfig)
    ? appConfig.workspaceInvitations
    : null;
  const normalizedSource = source && typeof source === "object" && !Array.isArray(source)
    ? source
    : {};

  return Object.freeze({
    enabled: normalizedSource.enabled !== false,
    allowInPersonalMode: normalizedSource.allowInPersonalMode !== false
  });
}

function resolveWorkspaceInvitationsPolicy({
  appConfig = {},
  tenancyProfile = null
} = {}) {
  const config = normalizeWorkspaceInvitationsConfig(appConfig);
  const normalizedTenancyProfile = tenancyProfile && typeof tenancyProfile === "object"
    ? tenancyProfile
    : {};
  const tenancyMode = normalizeTenancyMode(normalizedTenancyProfile.mode || appConfig?.tenancyMode);
  const workspaceEnabled = normalizedTenancyProfile?.workspace?.enabled === true || tenancyMode !== TENANCY_MODE_NONE;
  const enabledForTenancyMode = tenancyMode !== TENANCY_MODE_PERSONAL || config.allowInPersonalMode === true;
  const enabled = config.enabled === true && workspaceEnabled && enabledForTenancyMode;

  return Object.freeze({
    enabled,
    workspaceEnabled,
    allowInPersonalMode: config.allowInPersonalMode,
    tenancyMode
  });
}

export {
  normalizeWorkspaceInvitationsConfig,
  resolveWorkspaceInvitationsPolicy
};
