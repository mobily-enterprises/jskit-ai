import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveWorkspaceThemePalettes } from "../../../shared/settings.js";

function mapWorkspaceSummary(workspace, membership, roleCatalog = null) {
  const roleSid = normalizeLowerText(membership?.roleSid || "member") || "member";
  const roleLabel = roleCatalog?.roles?.find((role) => role.id === roleSid)?.label;
  return {
    id: normalizeRecordId(workspace.id, { fallback: "" }),
    slug: normalizeText(workspace.slug),
    name: normalizeText(workspace.name),
    avatarUrl: normalizeText(workspace.avatarUrl),
    roleSid,
    ...(roleLabel ? { roleLabel } : {}),
    isAccessible: normalizeLowerText(membership?.status || "active") === "active"
  };
}

/**
 * A workspace's settings as the bootstrap shows them.
 * @param {object} workspaceSettings The workspace's settings record.
 * @param {{ workspaceInvitationsEnabled: boolean }} policy Whether the app allows invitations.
 */
function mapWorkspaceSettingsPublic(workspaceSettings, { workspaceInvitationsEnabled }) {
  const invitesEnabled = workspaceInvitationsEnabled && workspaceSettings.invitesEnabled !== false;
  const themePalettes = resolveWorkspaceThemePalettes(workspaceSettings);

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
    invitesAvailable: workspaceInvitationsEnabled,
    invitesEffective: invitesEnabled
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
