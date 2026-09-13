import {
  normalizeRecordId,
  isDuplicateEntryError
} from "./repositoryUtils.js";
import {
  createJsonRestContext,
  extractJsonRestCollectionRows
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { DEFAULT_USER_SETTINGS } from "../../../shared/settings.js";

const USER_SETTINGS_PATCH_FIELDS = Object.freeze([
  "theme",
  "locale",
  "timeZone",
  "dateFormat",
  "numberFormat",
  "currencyCode",
  "avatarSize",
  "productUpdates",
  "accountActivity",
  "securityAlerts",
  "passwordSignInEnabled",
  "passwordSetupRequired"
]);

function pickPatchFields(source = {}) {
  const patch = {};

  for (const fieldName of USER_SETTINGS_PATCH_FIELDS) {
    if (Object.hasOwn(source, fieldName)) {
      patch[fieldName] = source[fieldName];
    }
  }

  return patch;
}

function createDefaultUserSettingsCreatePayload(userId) {
  return {
    id: userId,
    theme: DEFAULT_USER_SETTINGS.theme,
    locale: DEFAULT_USER_SETTINGS.locale,
    timeZone: DEFAULT_USER_SETTINGS.timeZone,
    dateFormat: DEFAULT_USER_SETTINGS.dateFormat,
    numberFormat: DEFAULT_USER_SETTINGS.numberFormat,
    currencyCode: DEFAULT_USER_SETTINGS.currencyCode,
    avatarSize: DEFAULT_USER_SETTINGS.avatarSize,
    productUpdates: DEFAULT_USER_SETTINGS.productUpdates,
    accountActivity: DEFAULT_USER_SETTINGS.accountActivity,
    securityAlerts: DEFAULT_USER_SETTINGS.securityAlerts,
    passwordSignInEnabled: DEFAULT_USER_SETTINGS.passwordSignInEnabled,
    passwordSetupRequired: DEFAULT_USER_SETTINGS.passwordSetupRequired
  };
}

function createRepository({ api } = {}) {
  if (!api?.resources?.userSettings) {
    throw new TypeError("userSettingsRepository requires json-rest-api userSettings resource.");
  }
  const withTransaction = (work) => api.transaction(work);

  async function queryFirst(filters = {}, options = {}) {
    const rows = extractJsonRestCollectionRows(
      await api.resources.userSettings.query(
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

  async function findByUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    return queryFirst({ id: normalizedUserId }, options);
  }

  async function ensureForUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      throw new TypeError("userSettingsRepository.ensureForUserId requires a valid user id.");
    }

    const existing = await findByUserId(normalizedUserId, options);
    if (existing) {
      return existing;
    }

    try {
      await api.resources.userSettings.post(
        {
          data: createDefaultUserSettingsCreatePayload(normalizedUserId),
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

    return findByUserId(normalizedUserId, options);
  }

  async function patchUserSettings(userId, patch = {}, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      throw new TypeError("userSettingsRepository.patchUserSettings requires a valid user id.");
    }

    await ensureForUserId(normalizedUserId, options);
    const source = patch && typeof patch === "object" ? patch : {};
    const updatePayload = pickPatchFields(source);

    if (Object.keys(updatePayload).length < 1) {
      return findByUserId(normalizedUserId, options);
    }

    await api.resources.userSettings.patch(
      {
        id: normalizedUserId,
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

    return findByUserId(normalizedUserId, options);
  }

  async function updatePreferences(userId, patch = {}, options = {}) {
    return patchUserSettings(userId, patch, options);
  }

  async function updateNotifications(userId, patch = {}, options = {}) {
    return patchUserSettings(userId, patch, options);
  }

  async function updatePasswordSignInEnabled(userId, enabled, options = {}) {
    return patchUserSettings(
      userId,
      {
        passwordSignInEnabled: enabled,
        ...(Object.hasOwn(options, "passwordSetupRequired")
          ? { passwordSetupRequired: options.passwordSetupRequired }
          : {})
      },
      options
    );
  }

  async function updatePasswordSetupRequired(userId, required, options = {}) {
    return patchUserSettings(userId, { passwordSetupRequired: required }, options);
  }

  return Object.freeze({
    withTransaction,
    findByUserId,
    ensureForUserId,
    patchUserSettings,
    updatePreferences,
    updateNotifications,
    updatePasswordSignInEnabled,
    updatePasswordSetupRequired
  });
}

export { createRepository };
