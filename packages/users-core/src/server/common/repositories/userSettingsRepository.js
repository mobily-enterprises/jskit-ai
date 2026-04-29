import { normalizeRecordId, nowDb, isDuplicateEntryError, createWithTransaction } from "./repositoryUtils.js";

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

function createRepository({ api, knex } = {}) {
  if (!api?.resources?.userSettings) {
    throw new TypeError("userSettingsRepository requires json-rest-api userSettings resource.");
  }
  if (typeof knex !== "function") {
    throw new TypeError("userSettingsRepository requires knex.");
  }
  const withTransaction = createWithTransaction(knex);

  async function queryFirst(filters = {}, options = {}) {
    const result = await api.resources.userSettings.query({
      queryParams: {
        filters
      },
      transaction: options?.trx,
      simplified: true
    });

    return Array.isArray(result?.data) ? result.data[0] || null : null;
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

    const existing = await findByUserId(normalizedUserId, { trx: options?.trx });
    if (existing) {
      return existing;
    }

    try {
      await api.resources.userSettings.post({
        id: normalizedUserId,
        transaction: options?.trx
      });
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByUserId(normalizedUserId, { trx: options?.trx });
  }

  async function patchUserSettings(userId, patch = {}, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      throw new TypeError("userSettingsRepository.patchUserSettings requires a valid user id.");
    }

    await ensureForUserId(normalizedUserId, { trx: options?.trx });
    const source = patch && typeof patch === "object" ? patch : {};
    const updatePayload = pickPatchFields(source);

    if (Object.keys(updatePayload).length < 1) {
      return findByUserId(normalizedUserId, { trx: options?.trx });
    }

    await api.resources.userSettings.patch({
      id: normalizedUserId,
      ...updatePayload,
      updatedAt: nowDb(),
      transaction: options?.trx
    });

    return findByUserId(normalizedUserId, { trx: options?.trx });
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
