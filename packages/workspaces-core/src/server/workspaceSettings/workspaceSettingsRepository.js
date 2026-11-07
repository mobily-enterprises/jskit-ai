import { isLostDuplicateInsertRace } from "@jskit-ai/database-runtime/shared";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { WORKSPACE_SETTINGS_FIELD_KEYS } from "../../shared/resources/workspaceSettingsResource.js";
import { resolveWorkspaceThemePalettes } from "../../shared/settings.js";

function buildDefaultWorkspaceSettingsCreatePayload(workspaceId, defaultInvitesEnabled, defaultColorSettings) {
  const palettes = resolveWorkspaceThemePalettes(defaultColorSettings);

  return {
    id: workspaceId,
    lightPrimaryColor: palettes.light.color,
    lightSecondaryColor: palettes.light.secondaryColor,
    lightSurfaceColor: palettes.light.surfaceColor,
    lightSurfaceVariantColor: palettes.light.surfaceVariantColor,
    darkPrimaryColor: palettes.dark.color,
    darkSecondaryColor: palettes.dark.secondaryColor,
    darkSurfaceColor: palettes.dark.surfaceColor,
    darkSurfaceVariantColor: palettes.dark.surfaceVariantColor,
    invitesEnabled: defaultInvitesEnabled
  };
}

/**
 * The workspaces' settings records, `repositories.workspaceSettings` of
 * `workspaces.core`. Every method takes the caller's options last and joins
 * their transaction.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.workspaceSettings
 *   The workspace_settings table's handle.
 * @param {boolean} dependencies.defaultInvitesEnabled
 * @param {object} dependencies.defaultColorSettings The configured colors that replace the theme's.
 */
function createRepository({ workspaceSettings, defaultInvitesEnabled, defaultColorSettings }) {
  async function findByWorkspaceId(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    const { records } = await workspaceSettings.query({ filters: { id: normalizedWorkspaceId }, page: { size: 1 } }, options);
    return records[0] || null;
  }

  async function ensureForWorkspaceId(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      throw new TypeError("workspaceSettingsRepository.ensureForWorkspaceId requires a valid workspace id.");
    }

    const existing = await findByWorkspaceId(normalizedWorkspaceId, options);
    if (existing) {
      return existing;
    }

    try {
      await workspaceSettings.create(
        buildDefaultWorkspaceSettingsCreatePayload(normalizedWorkspaceId, defaultInvitesEnabled, defaultColorSettings),
        { ...options, returning: "none" }
      );
    } catch (error) {
      // A standalone insert that lost to another one reads the winner; inside the caller's transaction it fails it.
      if (!isLostDuplicateInsertRace(error, options)) {
        throw error;
      }
    }

    return findByWorkspaceId(normalizedWorkspaceId, options);
  }

  async function updateSettingsByWorkspaceId(workspaceId, patch, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      throw new TypeError("workspaceSettingsRepository.updateSettingsByWorkspaceId requires a valid workspace id.");
    }

    await ensureForWorkspaceId(normalizedWorkspaceId, options);
    const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    const updatePayload = pickOwnProperties(source, WORKSPACE_SETTINGS_FIELD_KEYS);

    if (Object.keys(updatePayload).length < 1) {
      return findByWorkspaceId(normalizedWorkspaceId, options);
    }

    await workspaceSettings.patch(
      normalizedWorkspaceId,
      {
        ...updatePayload,
        updatedAt: new Date().toISOString()
      },
      { ...options, returning: "none" }
    );

    return findByWorkspaceId(normalizedWorkspaceId, options);
  }

  return Object.freeze({
    withTransaction: workspaceSettings.withTransaction,
    findByWorkspaceId,
    ensureForWorkspaceId,
    updateSettingsByWorkspaceId
  });
}

export { createRepository };
