import {
  normalizeRecordId,
  isDuplicateEntryError
} from "../common/repositories/repositoryUtils.js";
import {
  createJsonRestContext,
  extractJsonRestCollectionRows
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { resolveWorkspaceThemePalettes } from "../../shared/settings.js";

const WORKSPACE_SETTINGS_PATCH_FIELDS = Object.freeze([
  "lightPrimaryColor",
  "lightSecondaryColor",
  "lightSurfaceColor",
  "lightSurfaceVariantColor",
  "darkPrimaryColor",
  "darkSecondaryColor",
  "darkSurfaceColor",
  "darkSurfaceVariantColor",
  "invitesEnabled"
]);

function pickPatchFields(source = {}) {
  const patch = {};

  for (const fieldName of WORKSPACE_SETTINGS_PATCH_FIELDS) {
    if (Object.hasOwn(source, fieldName)) {
      patch[fieldName] = source[fieldName];
    }
  }

  return patch;
}

function createDefaultWorkspaceSettingsCreatePayload(workspaceId, defaultInvitesEnabled) {
  const palettes = resolveWorkspaceThemePalettes({});

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

function createRepository({ api, defaultInvitesEnabled = true } = {}) {
  if (!api?.resources?.workspaceSettings) {
    throw new TypeError("workspaceSettingsRepository requires json-rest-api workspaceSettings resource.");
  }
  const withTransaction = (work) => api.transaction(work);

  async function queryFirst(filters = {}, options = {}) {
    const rows = extractJsonRestCollectionRows(
      await api.resources.workspaceSettings.query(
        {
          queryParams: {
            filters
          },
          transaction: options?.trx || null,
          format: "plain"
        },
        createJsonRestContext(options?.context || null)
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
          data: createDefaultWorkspaceSettingsCreatePayload(normalizedWorkspaceId, defaultInvitesEnabled === true),
          format: "plain",
          returning: "full",
          transaction: options?.trx || null
        },
        createJsonRestContext(options?.context || null)
      );
    } catch (error) {
      if (options?.trx || error?.transactionOutcome !== "rolledBack" || !isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByWorkspaceId(normalizedWorkspaceId, options);
  }

  async function updateSettingsByWorkspaceId(workspaceId, patch = {}, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      throw new TypeError("workspaceSettingsRepository.updateSettingsByWorkspaceId requires a valid workspace id.");
    }

    await ensureForWorkspaceId(normalizedWorkspaceId, options);
    const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    const updatePayload = pickPatchFields(source);

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
        transaction: options?.trx || null
      },
      createJsonRestContext(options?.context || null)
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
