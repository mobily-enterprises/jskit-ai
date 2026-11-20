import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { TENANCY_MODE_PERSONAL } from "../../shared/tenancyMode.js";

/** @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} appConfig */
function normalizeWorkspaceInvitationsConfig(appConfig) {
  const source = isRecord(appConfig.workspaceInvitations) ? appConfig.workspaceInvitations : {};

  return Object.freeze({
    enabled: source.enabled !== false,
    allowInPersonalMode: source.allowInPersonalMode !== false,
    anyAccount: source.anyAccount === true
  });
}

/**
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} options.appConfig
 * @param {import("../types.js").WorkspaceTenancyProfile} options.tenancyProfile
 */
function resolveWorkspaceInvitationsPolicy({ appConfig, tenancyProfile }) {
  const config = normalizeWorkspaceInvitationsConfig(appConfig);
  const tenancyMode = tenancyProfile.mode;
  const workspaceEnabled = tenancyProfile.workspace.enabled === true;
  const enabledForTenancyMode = tenancyMode !== TENANCY_MODE_PERSONAL || config.allowInPersonalMode === true;
  const enabled = config.enabled === true && workspaceEnabled && enabledForTenancyMode;

  return Object.freeze({
    enabled,
    workspaceEnabled,
    allowInPersonalMode: config.allowInPersonalMode,
    // Any signed-in account holding an invitation's link may accept it, unless its workspace requires the invited
    // address (invitesRequireSameEmail); off, only the account whose email is the invited one may.
    anyAccount: enabled && config.anyAccount,
    tenancyMode
  });
}

export { resolveWorkspaceInvitationsPolicy };
