import {
  createSimplifiedWriteParams,
  normalizeRecordId,
  nowDb,
  isDuplicateEntryError,
  createWithTransaction
} from "../common/repositories/repositoryUtils.js";
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

function createDefaultWorkspaceSettingsCreatePayload(workspaceId) {
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
    invitesEnabled: true
  };
}

function createRepository({ api, knex } = {}) {
  if (!api?.resources?.workspaceSettings) {
    throw new TypeError("workspaceSettingsRepository requires json-rest-api workspaceSettings resource.");
  }
  if (typeof knex !== "function") {
    throw new TypeError("workspaceSettingsRepository requires knex.");
  }
  const withTransaction = createWithTransaction(knex);

  async function queryFirst(filters = {}, options = {}) {
    const result = await api.resources.workspaceSettings.query({
      queryParams: {
        filters
      },
      transaction: options?.trx,
      simplified: true
    });

    return Array.isArray(result?.data) ? result.data[0] || null : null;
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

    const existing = await findByWorkspaceId(normalizedWorkspaceId, { trx: options?.trx });
    if (existing) {
      return existing;
    }

    try {
      await api.resources.workspaceSettings.post(
        createSimplifiedWriteParams(
          createDefaultWorkspaceSettingsCreatePayload(normalizedWorkspaceId),
          { trx: options?.trx }
        )
      );
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByWorkspaceId(normalizedWorkspaceId, { trx: options?.trx });
  }

  async function updateSettingsByWorkspaceId(workspaceId, patch = {}, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      throw new TypeError("workspaceSettingsRepository.updateSettingsByWorkspaceId requires a valid workspace id.");
    }

    await ensureForWorkspaceId(normalizedWorkspaceId, { trx: options?.trx });
    const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    const updatePayload = pickPatchFields(source);

    if (Object.keys(updatePayload).length < 1) {
      return findByWorkspaceId(normalizedWorkspaceId, { trx: options?.trx });
    }

    await api.resources.workspaceSettings.patch(
      createSimplifiedWriteParams(
        {
          id: normalizedWorkspaceId,
          ...updatePayload,
          updatedAt: nowDb()
        },
        { trx: options?.trx }
      )
    );

    return findByWorkspaceId(normalizedWorkspaceId, { trx: options?.trx });
  }

  return Object.freeze({
    withTransaction,
    findByWorkspaceId,
    ensureForWorkspaceId,
    updateSettingsByWorkspaceId
  });
}

export { createRepository };
