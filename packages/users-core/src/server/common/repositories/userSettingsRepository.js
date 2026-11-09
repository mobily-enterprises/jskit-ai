import { isLostDuplicateInsertRace } from "@jskit-ai/database-runtime/shared";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { DEFAULT_USER_SETTINGS, normalizeLocaleCode } from "../../../shared/settings.js";
import { queryAllByIds } from "./recordsByIds.js";

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

// Rows saved before locales were canonical hold lowercased tags ("en-us").
function withCanonicalLocale(row) {
  return typeof row?.locale === "string" ? { ...row, locale: normalizeLocaleCode(row.locale) } : row;
}

function buildDefaultUserSettingsCreatePayload(userId) {
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

/**
 * The `users.settings` capability: the user_settings table's records. Every
 * method takes the caller's options last and joins their transaction.
 * @param {{ userSettings: import("@jskit-ai/resource-runtime/server/types").ResourceHandle }} dependencies
 *   The user_settings table's handle.
 */
function createRepository({ userSettings }) {
  async function findByUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    const { records } = await userSettings.query({ filters: { id: normalizedUserId }, page: { size: 1 } }, options);
    return withCanonicalLocale(records[0] || null);
  }

  /**
   * The settings of these users, all of them in one call however many, sorted
   * by user id: one read per 1,000 distinct ids, each joining the caller's
   * transaction. A user named twice answers once; a user without settings,
   * or a value that is no id, is left out.
   * @param {readonly unknown[]} userIds
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} [options]
   */
  async function listByUserIds(userIds, options = {}) {
    return (await queryAllByIds(userSettings, "listByUserIds", userIds, options)).map(withCanonicalLocale);
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
      await userSettings.create(buildDefaultUserSettingsCreatePayload(normalizedUserId), { ...options, returning: "none" });
    } catch (error) {
      // A standalone insert that lost to another one reads the winner; inside the caller's transaction it fails it.
      if (!isLostDuplicateInsertRace(error, options)) {
        throw error;
      }
    }

    return findByUserId(normalizedUserId, options);
  }

  async function patchUserSettings(userId, patch, options = {}) {
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

    await userSettings.patch(
      normalizedUserId,
      {
        ...updatePayload,
        updatedAt: new Date().toISOString()
      },
      { ...options, returning: "none" }
    );

    return findByUserId(normalizedUserId, options);
  }

  async function updatePreferences(userId, patch, options = {}) {
    return patchUserSettings(userId, patch, options);
  }

  async function updateNotifications(userId, patch, options = {}) {
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
    withTransaction: userSettings.withTransaction,
    // The users' settings as a join source for another owner's report, which reads them in its own statement: the
    // handle's joinSource, under `alias`, keyed by the user's id (`column("id")`).
    joinSource: userSettings.joinSource,
    findByUserId,
    listByUserIds,
    ensureForUserId,
    patchUserSettings,
    updatePreferences,
    updateNotifications,
    updatePasswordSignInEnabled,
    updatePasswordSetupRequired
  });
}

export { createRepository };
