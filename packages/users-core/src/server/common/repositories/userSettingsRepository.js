import {
  normalizeLowerText,
  normalizeText,
  toIsoString,
  nowDb,
  isDuplicateEntryError
} from "./repositoryUtils.js";
import { DEFAULT_USER_SETTINGS } from "../../../shared/settings.js";

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    userId: Number(row.user_id),
    lastActiveWorkspaceId: row.last_active_workspace_id == null ? null : Number(row.last_active_workspace_id),
    theme: normalizeText(row.theme),
    locale: normalizeText(row.locale),
    timeZone: normalizeText(row.time_zone),
    dateFormat: normalizeText(row.date_format),
    numberFormat: normalizeText(row.number_format),
    currencyCode: normalizeText(row.currency_code),
    avatarSize: Number(row.avatar_size || DEFAULT_USER_SETTINGS.avatarSize),
    passwordSignInEnabled: row.password_sign_in_enabled == null ? true : Boolean(row.password_sign_in_enabled),
    passwordSetupRequired: row.password_setup_required == null ? false : Boolean(row.password_setup_required),
    productUpdates: Boolean(row.notify_product_updates),
    accountActivity: Boolean(row.notify_account_activity),
    securityAlerts: Boolean(row.notify_security_alerts),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  return value === true;
}

function createInsertPayload(userId) {
  return {
    user_id: Number(userId),
    last_active_workspace_id: null,
    theme: DEFAULT_USER_SETTINGS.theme,
    locale: DEFAULT_USER_SETTINGS.locale,
    time_zone: DEFAULT_USER_SETTINGS.timeZone,
    date_format: DEFAULT_USER_SETTINGS.dateFormat,
    number_format: DEFAULT_USER_SETTINGS.numberFormat,
    currency_code: DEFAULT_USER_SETTINGS.currencyCode,
    avatar_size: DEFAULT_USER_SETTINGS.avatarSize,
    password_sign_in_enabled: DEFAULT_USER_SETTINGS.passwordSignInEnabled,
    password_setup_required: DEFAULT_USER_SETTINGS.passwordSetupRequired,
    notify_product_updates: DEFAULT_USER_SETTINGS.productUpdates,
    notify_account_activity: DEFAULT_USER_SETTINGS.accountActivity,
    notify_security_alerts: DEFAULT_USER_SETTINGS.securityAlerts,
    created_at: nowDb(),
    updated_at: nowDb()
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("userSettingsRepository requires knex.");
  }

  async function findByUserId(userId, options = {}) {
    const client = options?.trx || knex;
    const row = await client("user_settings").where({ user_id: Number(userId) }).first();
    return mapRow(row);
  }

  async function ensureForUserId(userId, options = {}) {
    const client = options?.trx || knex;
    const numericUserId = Number(userId);
    const existing = await findByUserId(numericUserId, { trx: client });
    if (existing) {
      return existing;
    }

    try {
      await client("user_settings").insert(createInsertPayload(numericUserId));
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByUserId(numericUserId, { trx: client });
  }

  async function patchUserSettings(userId, patch = {}, options = {}) {
    const client = options?.trx || knex;
    const ensured = await ensureForUserId(userId, { trx: client });
    const source = patch && typeof patch === "object" ? patch : {};

    const dbPatch = {
      updated_at: nowDb()
    };

    if (Object.hasOwn(source, "theme")) {
      dbPatch.theme = normalizeText(source.theme) || ensured.theme;
    }
    if (Object.hasOwn(source, "locale")) {
      dbPatch.locale = normalizeLowerText(source.locale) || ensured.locale;
    }
    if (Object.hasOwn(source, "timeZone")) {
      dbPatch.time_zone = normalizeText(source.timeZone) || ensured.timeZone;
    }
    if (Object.hasOwn(source, "dateFormat")) {
      dbPatch.date_format = normalizeText(source.dateFormat) || ensured.dateFormat;
    }
    if (Object.hasOwn(source, "numberFormat")) {
      dbPatch.number_format = normalizeText(source.numberFormat) || ensured.numberFormat;
    }
    if (Object.hasOwn(source, "currencyCode")) {
      dbPatch.currency_code = normalizeText(source.currencyCode).toUpperCase() || ensured.currencyCode;
    }
    if (Object.hasOwn(source, "avatarSize")) {
      dbPatch.avatar_size = Number(source.avatarSize || ensured.avatarSize || DEFAULT_USER_SETTINGS.avatarSize);
    }
    if (Object.hasOwn(source, "productUpdates")) {
      dbPatch.notify_product_updates = normalizeBoolean(source.productUpdates, ensured.productUpdates);
    }
    if (Object.hasOwn(source, "accountActivity")) {
      dbPatch.notify_account_activity = normalizeBoolean(source.accountActivity, ensured.accountActivity);
    }
    if (Object.hasOwn(source, "securityAlerts")) {
      dbPatch.notify_security_alerts = normalizeBoolean(source.securityAlerts, ensured.securityAlerts);
    }
    if (Object.hasOwn(source, "passwordSignInEnabled")) {
      dbPatch.password_sign_in_enabled = normalizeBoolean(source.passwordSignInEnabled, ensured.passwordSignInEnabled);
    }
    if (Object.hasOwn(source, "passwordSetupRequired")) {
      dbPatch.password_setup_required = normalizeBoolean(source.passwordSetupRequired, ensured.passwordSetupRequired);
    }
    if (Object.hasOwn(source, "lastActiveWorkspaceId")) {
      dbPatch.last_active_workspace_id = source.lastActiveWorkspaceId == null ? null : Number(source.lastActiveWorkspaceId);
    }

    await client("user_settings").where({ user_id: Number(userId) }).update(dbPatch);
    return findByUserId(userId, { trx: client });
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
        passwordSetupRequired: Object.hasOwn(options, "passwordSetupRequired")
          ? options.passwordSetupRequired
          : undefined
      },
      options
    );
  }

  async function updatePasswordSetupRequired(userId, required, options = {}) {
    return patchUserSettings(userId, { passwordSetupRequired: required }, options);
  }

  async function updateLastActiveWorkspaceId(userId, workspaceId, options = {}) {
    return patchUserSettings(userId, { lastActiveWorkspaceId: workspaceId }, options);
  }

  return Object.freeze({
    findByUserId,
    ensureForUserId,
    patchUserSettings,
    updatePreferences,
    updateNotifications,
    updatePasswordSignInEnabled,
    updatePasswordSetupRequired,
    updateLastActiveWorkspaceId
  });
}

export { createRepository, mapRow };
