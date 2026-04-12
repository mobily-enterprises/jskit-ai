import { resolveWorkspaceThemePalettes } from "../../../shared/settings.js";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function mapWorkspaceSummary(workspace, membership) {
  return {
    id: normalizeRecordId(workspace.id, { fallback: "" }),
    slug: normalizeText(workspace.slug),
    name: normalizeText(workspace.name),
    avatarUrl: normalizeText(workspace.avatarUrl),
    roleSid: normalizeLowerText(membership?.roleSid || "member") || "member",
    isAccessible: normalizeLowerText(membership?.status || "active") === "active"
  };
}

function mapWorkspaceSettingsPublic(workspaceSettings, { workspaceInvitationsEnabled = true } = {}) {
  const source = workspaceSettings && typeof workspaceSettings === "object" ? workspaceSettings : {};
  const invitesAvailable = workspaceInvitationsEnabled === true;
  const invitesEnabled = invitesAvailable && source.invitesEnabled !== false;
  const themePalettes = resolveWorkspaceThemePalettes(source);

  return {
    lightPrimaryColor: themePalettes.light.color,
    lightSecondaryColor: themePalettes.light.secondaryColor,
    lightSurfaceColor: themePalettes.light.surfaceColor,
    lightSurfaceVariantColor: themePalettes.light.surfaceVariantColor,
    darkPrimaryColor: themePalettes.dark.color,
    darkSecondaryColor: themePalettes.dark.secondaryColor,
    darkSurfaceColor: themePalettes.dark.surfaceColor,
    darkSurfaceVariantColor: themePalettes.dark.surfaceVariantColor,
    invitesEnabled,
    invitesAvailable,
    invitesEffective: invitesAvailable && invitesEnabled
  };
}

function mapMembershipSummary(membership, workspace) {
  if (!membership) {
    return null;
  }

  return {
    workspaceId: normalizeRecordId(workspace?.id || membership.workspaceId, { fallback: "" }),
    roleSid: normalizeLowerText(membership.roleSid || "member") || "member",
    status: normalizeLowerText(membership.status || "active") || "active"
  };
}

export {
  mapMembershipSummary,
  mapWorkspaceSettingsPublic,
  mapWorkspaceSummary
};
