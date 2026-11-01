import { isLostDuplicateInsertRace, resolveTransaction, retryDeadlocks } from "@jskit-ai/database-runtime/shared";
import {
  createJsonRestContext,
  extractJsonRestCollectionRows
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
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
 * @param {object} dependencies
 * @param {import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi} dependencies.api
 * @param {boolean} dependencies.defaultInvitesEnabled
 * @param {object} dependencies.defaultColorSettings The configured colors that replace the theme's.
 */
function createRepository({ api, defaultInvitesEnabled, defaultColorSettings }) {
  const withTransaction = (work) => retryDeadlocks(() => api.transaction(work));

  async function queryFirst(filters = {}, options = {}) {
    const rows = extractJsonRestCollectionRows(
      await api.resources.workspaceSettings.query(
        {
          queryParams: {
            filters
          },
          transaction: resolveTransaction(options),
          format: "plain"
        },
        createJsonRestContext(options.context)
      )
    );

    return rows[0] || null;
  }

  async function findByWorkspaceId(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    return queryFirst({ id: normalizedWorkspaceId }, options);
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
      await api.resources.workspaceSettings.post(
        {
          data: buildDefaultWorkspaceSettingsCreatePayload(
            normalizedWorkspaceId,
            defaultInvitesEnabled,
            defaultColorSettings
          ),
          format: "plain",
          returning: "full",
          transaction: resolveTransaction(options)
        },
        createJsonRestContext(options.context)
      );
    } catch (error) {
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

    await api.resources.workspaceSettings.patch(
      {
        id: normalizedWorkspaceId,
        data: {
          ...updatePayload,
          updatedAt: new Date().toISOString()
        },
        format: "plain",
        returning: "full",
        transaction: resolveTransaction(options)
      },
      createJsonRestContext(options.context)
    );

    return findByWorkspaceId(normalizedWorkspaceId, options);
  }

  return Object.freeze({
    withTransaction,
    findByWorkspaceId,
    ensureForWorkspaceId,
    updateSettingsByWorkspaceId
  });
}

export { createRepository };
